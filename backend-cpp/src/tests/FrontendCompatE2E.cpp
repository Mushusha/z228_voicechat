#include <iostream>
#include <set>
#include <string>

#include "app/AppConfig.h"
#include "app/BackendApp.h"
#include "app/ServerRunner.h"
#include "transport/server/StubLiveHarness.h"
#include "transport/server/StubLiveServerAdapter.h"

namespace {

bool hasEvent(
    const std::vector<lvchat::transport::server::HarnessDelivery>& delivered,
    const std::string& sessionId,
    const std::string& eventType) {
  const std::string marker = "\"type\":\"" + eventType + "\"";
  for (const auto& d : delivered) {
    if (d.sessionId == sessionId && d.payloadJson.find(marker) != std::string::npos) {
      return true;
    }
  }
  return false;
}

}  // namespace

int main() {
  lvchat::app::AppConfig cfg;
  cfg.serverAdapter = "stub-live";
  cfg.adminPassword = "admin123";
  cfg.serviceName = "frontend_compat_e2e";

  lvchat::app::BackendApp app(cfg);
  lvchat::transport::server::StubLiveServerAdapter adapter(app);
  lvchat::app::ServerRunner runner(app, adapter);
  runner.run();

  lvchat::transport::server::StubLiveHarness harness(adapter);
  harness.attachSession("f1");
  harness.attachSession("f2");

  harness.pushClientMessage("f1", "{\"type\":\"join\",\"nickname\":\"front-a\"}");
  harness.pushClientMessage("f2", "{\"type\":\"join\",\"nickname\":\"front-b\"}");
  harness.pushClientMessage("f1", "{\"type\":\"chat\",\"text\":\"msg-1\"}");
  harness.pushClientMessage("f1", "{\"type\":\"chat-react\",\"id\":\"1\",\"emoji\":\"👍\"}");
  harness.pushClientMessage("f1", "{\"type\":\"chat-edit\",\"id\":\"1\",\"text\":\"msg-1-edit\"}");
  harness.pushClientMessage("f1", "{\"type\":\"chat-delete\",\"id\":\"1\"}");
  harness.pushClientMessage("f1", "{\"type\":\"signal\",\"target\":\"front-b\",\"payload\":{\"kind\":\"offer\"}}");
  harness.pushClientMessage("f2", "{\"type\":\"admin-verify\",\"secret\":\"admin123\"}");
  harness.pushClientMessage("f2", "{\"type\":\"admin-peers\",\"secret\":\"admin123\"}");
  harness.pushClientMessage("f2", "{\"type\":\"admin-kick\",\"secret\":\"admin123\",\"target\":\"front-a\"}");

  const auto& out = harness.delivered();
  bool ok = true;
  ok = ok && hasEvent(out, "f1", "hello");
  ok = ok && hasEvent(out, "f2", "hello");
  ok = ok && hasEvent(out, "f1", "join-accepted");
  ok = ok && hasEvent(out, "f2", "join-accepted");
  ok = ok && hasEvent(out, "f1", "peer-joined");
  ok = ok && hasEvent(out, "f2", "chat-message");
  ok = ok && hasEvent(out, "f2", "chat-message-reactions");
  ok = ok && hasEvent(out, "f2", "chat-message-updated");
  ok = ok && hasEvent(out, "f2", "chat-message-deleted");
  ok = ok && hasEvent(out, "f2", "signal");
  ok = ok && hasEvent(out, "f2", "admin-verify-ok");
  ok = ok && hasEvent(out, "f2", "admin-peers-result");
  ok = ok && hasEvent(out, "f1", "kicked");
  ok = ok && hasEvent(out, "f2", "peer-left");

  runner.shutdown();
  if (!ok) {
    std::cerr << "[FAIL] Frontend compatibility E2E failed.\n";
    return 1;
  }
  std::cout << "[PASS] Frontend compatibility E2E passed.\n";
  return 0;
}
