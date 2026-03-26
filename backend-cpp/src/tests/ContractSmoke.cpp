#include <iostream>
#include <memory>
#include <string>
#include <vector>

#include "application/ChatService.h"
#include "application/RoomService.h"
#include "application/SignalingService.h"
#include "app/AppConfig.h"
#include "app/BackendApp.h"
#include "app/ServerRunner.h"
#include "infrastructure/MemoryChatRepository.h"
#include "infrastructure/SessionRegistry.h"
#include "transport/server/MockServerAdapter.h"
#include "transport/server/ServerAdapterFactory.h"
#include "transport/server/StubLiveServerAdapter.h"
#include "transport/ws/EventRouter.h"
#include "transport/ws/InMemoryConnectionHub.h"
#include "transport/ws/WsGateway.h"
#include "transport/ws/WsRuntime.h"

namespace {

bool containsPayload(
    const std::vector<lvchat::transport::ws::DeliveredMessage>& delivered,
    const std::string& sessionId,
    const std::string& mustContain) {
  for (const auto& d : delivered) {
    if (d.sessionId == sessionId && d.payloadJson.find(mustContain) != std::string::npos) {
      return true;
    }
  }
  return false;
}

bool expect(bool cond, const std::string& message) {
  if (cond) {
    return true;
  }
  std::cerr << "[FAIL] " << message << '\n';
  return false;
}

}  // namespace

int main() {
  bool ok = true;

  auto repo = std::make_shared<lvchat::infrastructure::MemoryChatRepository>();
  lvchat::infrastructure::SessionRegistry sessions;
  lvchat::application::ChatService chatService(repo);
  lvchat::application::RoomService roomService(sessions);
  lvchat::application::SignalingService signalingService;
  lvchat::transport::ws::EventRouter router(chatService, roomService, signalingService, "admin123");
  lvchat::transport::ws::WsRuntime runtime(router, roomService);
  lvchat::transport::ws::InMemoryConnectionHub hub;
  lvchat::transport::ws::WsGateway gateway(runtime, hub);

  gateway.handleConnect("s1");
  gateway.handleConnect("s2");
  gateway.handleMessage("s1", "{\"type\":\"join\",\"nickname\":\"alice\"}");
  gateway.handleMessage("s2", "{\"type\":\"join\",\"nickname\":\"bob\"}");
  gateway.handleMessage("s1", "{\"type\":\"chat\",\"text\":\"hello\"}");
  gateway.handleMessage("s1", "{\"type\":\"signal\",\"target\":\"bob\",\"payload\":{\"kind\":\"offer\"}}");
  gateway.handleMessage("s2", "{\"type\":\"admin-kick\",\"secret\":\"admin123\",\"target\":\"alice\"}");

  const auto delivered = hub.deliveredSnapshot();
  ok &= expect(containsPayload(delivered, "s1", "\"type\":\"hello\""), "missing hello for s1");
  ok &= expect(containsPayload(delivered, "s2", "\"type\":\"hello\""), "missing hello for s2");
  ok &= expect(containsPayload(delivered, "s1", "\"type\":\"join-accepted\""), "missing join-accepted for s1");
  ok &= expect(containsPayload(delivered, "s2", "\"type\":\"join-accepted\""), "missing join-accepted for s2");
  ok &= expect(containsPayload(delivered, "s1", "\"type\":\"peer-joined\""), "missing peer-joined broadcast");
  ok &= expect(containsPayload(delivered, "s2", "\"type\":\"chat-message\""), "missing chat-message to s2");
  ok &= expect(containsPayload(delivered, "s2", "\"type\":\"signal\""), "missing signal relay to target");
  ok &= expect(containsPayload(delivered, "s1", "\"type\":\"kicked\""), "missing kicked target message");
  ok &= expect(containsPayload(delivered, "s2", "\"type\":\"peer-left\""), "missing peer-left after kick");

  lvchat::app::AppConfig cfg;
  cfg.adminPassword = "admin123";
  cfg.serviceName = "contract_smoke";
  cfg.wsPort = 3000;
  lvchat::app::BackendApp app(cfg);
  ok &= expect(app.healthJson().find("\"uptimeSec\"") != std::string::npos, "health should contain uptimeSec");
  ok &= expect(app.healthJson().find("\"stats\"") != std::string::npos, "health should contain stats");
  app.handleConnect("metrics-1");
  app.handleMessage("metrics-1", "{\"type\":\"join\",\"nickname\":\"metrics\"}");
  app.handleDisconnect("metrics-1");
  const auto stats = app.statsSnapshot();
  ok &= expect(stats.connectCount >= 1, "stats.connect should increase");
  ok &= expect(stats.messageCount >= 1, "stats.message should increase");
  ok &= expect(stats.disconnectCount >= 1, "stats.disconnect should increase");
  auto adapter = lvchat::transport::server::makeServerAdapter(cfg, app);
  lvchat::app::ServerRunner runner(app, *adapter);
  runner.run();
  ok &= expect(runner.running(), "runner should be running after run()");
  runner.shutdown();
  ok &= expect(!runner.running(), "runner should stop after shutdown()");

  cfg.serverAdapter = "stub-live";
  lvchat::app::BackendApp app2(cfg);
  auto adapter2 = lvchat::transport::server::makeServerAdapter(cfg, app2);
  lvchat::app::ServerRunner runner2(app2, *adapter2);
  runner2.run();
  ok &= expect(runner2.running(), "stub-live adapter should report running after run()");
  auto* live = dynamic_cast<lvchat::transport::server::StubLiveServerAdapter*>(adapter2.get());
  ok &= expect(live != nullptr, "factory should return StubLiveServerAdapter for stub-live");
  if (live != nullptr) {
    std::vector<std::string> s1Out;
    std::vector<std::string> s2Out;
    live->bindSessionSender("x1", [&](const std::string& payload) { s1Out.push_back(payload); });
    live->bindSessionSender("x2", [&](const std::string& payload) { s2Out.push_back(payload); });
    live->onSocketOpen("x1");
    live->onSocketOpen("x2");
    live->onSocketMessage("x1", "{\"type\":\"join\",\"nickname\":\"tester-1\"}");
    live->onSocketMessage("x2", "{\"type\":\"join\",\"nickname\":\"tester-2\"}");
    live->onSocketMessage("x1", "{\"type\":\"chat\",\"text\":\"bridge-check\"}");
    ok &= expect(!s1Out.empty(), "stub-live bridge should send payloads to x1");
    ok &= expect(!s2Out.empty(), "stub-live bridge should send payloads to x2");
    bool sawChat = false;
    for (const auto& payload : s2Out) {
      if (payload.find("\"type\":\"chat-message\"") != std::string::npos) {
        sawChat = true;
        break;
      }
    }
    ok &= expect(sawChat, "stub-live bridge should relay chat-message to peer");
  }
  runner2.shutdown();
  ok &= expect(!runner2.running(), "stub-live adapter should stop after shutdown()");

  if (!ok) {
    return 1;
  }

  std::cout << "[PASS] Contract smoke checks passed.\n";
  return 0;
}
