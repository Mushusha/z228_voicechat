#include <iostream>
#include <set>
#include <string>

#include "app/AppConfig.h"
#include "app/BackendApp.h"
#include "app/ServerRunner.h"
#include "transport/server/StubLiveHarness.h"
#include "transport/server/StubLiveServerAdapter.h"

namespace {

void collectEventTypes(
    const std::vector<lvchat::transport::server::HarnessDelivery>& delivered,
    std::set<std::string>& outTypes) {
  for (const auto& d : delivered) {
    const auto pos = d.payloadJson.find("\"type\":\"");
    if (pos == std::string::npos) {
      continue;
    }
    const auto start = pos + 8;
    const auto end = d.payloadJson.find('"', start);
    if (end == std::string::npos || end <= start) {
      continue;
    }
    outTypes.insert(d.payloadJson.substr(start, end - start));
  }
}

bool hasAll(const std::set<std::string>& got, const std::set<std::string>& required) {
  for (const auto& e : required) {
    if (!got.contains(e)) {
      std::cerr << "[MISSING] " << e << '\n';
      return false;
    }
  }
  return true;
}

}  // namespace

int main() {
  lvchat::app::AppConfig cfg;
  cfg.serverAdapter = "stub-live";
  cfg.adminPassword = "admin123";
  cfg.serviceName = "ws_event_contract";

  lvchat::app::BackendApp app(cfg);
  lvchat::transport::server::StubLiveServerAdapter adapter(app);
  lvchat::app::ServerRunner runner(app, adapter);
  runner.run();

  lvchat::transport::server::StubLiveHarness harness(adapter);
  harness.attachSession("u1");
  harness.attachSession("u2");

  harness.pushClientMessage("u1", "{\"type\":\"join\",\"nickname\":\"alpha\"}");
  harness.pushClientMessage("u2", "{\"type\":\"join\",\"nickname\":\"beta\"}");
  harness.pushClientMessage("u1", "{\"type\":\"chat\",\"text\":\"contract\"}");
  harness.pushClientMessage("u1", "{\"type\":\"chat-react\",\"id\":\"1\",\"emoji\":\"👍\"}");
  harness.pushClientMessage("u1", "{\"type\":\"chat-edit\",\"id\":\"1\",\"text\":\"contract-edit\"}");
  harness.pushClientMessage("u1", "{\"type\":\"signal\",\"target\":\"beta\",\"payload\":{\"kind\":\"offer\"}}");
  harness.pushClientMessage("u2", "{\"type\":\"admin-peers\",\"secret\":\"admin123\"}");
  harness.pushClientMessage("u2", "{\"type\":\"admin-kick\",\"secret\":\"admin123\",\"target\":\"alpha\"}");

  std::set<std::string> types;
  collectEventTypes(harness.delivered(), types);

  const std::set<std::string> required = {
      "hello",
      "join-accepted",
      "peer-joined",
      "chat-history",
      "chat-message",
      "chat-message-reactions",
      "chat-message-updated",
      "signal",
      "admin-peers-result",
      "kicked",
      "peer-left"};

  const bool ok = hasAll(types, required);
  runner.shutdown();

  if (!ok) {
    std::cerr << "[FAIL] WS event contract failed.\n";
    return 1;
  }
  std::cout << "[PASS] WS event contract passed.\n";
  return 0;
}
