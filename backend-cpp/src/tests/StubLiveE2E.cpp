#include <iostream>

#include "app/AppConfig.h"
#include "app/BackendApp.h"
#include "app/ServerRunner.h"
#include "transport/server/StubLiveHarness.h"
#include "transport/server/StubLiveServerAdapter.h"

namespace {

bool contains(
    const std::vector<lvchat::transport::server::HarnessDelivery>& delivered,
    const std::string& sessionId,
    const std::string& marker) {
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
  cfg.serviceName = "stub_live_e2e";

  lvchat::app::BackendApp app(cfg);
  lvchat::transport::server::StubLiveServerAdapter adapter(app);
  lvchat::app::ServerRunner runner(app, adapter);
  runner.run();

  lvchat::transport::server::StubLiveHarness harness(adapter);
  harness.attachSession("u1");
  harness.attachSession("u2");
  harness.pushClientMessage("u1", "{\"type\":\"join\",\"nickname\":\"alpha\"}");
  harness.pushClientMessage("u2", "{\"type\":\"join\",\"nickname\":\"beta\"}");
  harness.pushClientMessage("u1", "{\"type\":\"chat\",\"text\":\"e2e-check\"}");
  harness.pushClientMessage("u1", "{\"type\":\"signal\",\"target\":\"beta\",\"payload\":{\"kind\":\"offer\"}}");
  harness.pushClientMessage("u2", "{\"type\":\"admin-kick\",\"secret\":\"admin123\",\"target\":\"alpha\"}");
  harness.detachSession("u2");

  const auto& delivered = harness.delivered();
  bool ok = true;
  ok = ok && contains(delivered, "u1", "\"type\":\"hello\"");
  ok = ok && contains(delivered, "u2", "\"type\":\"hello\"");
  ok = ok && contains(delivered, "u1", "\"type\":\"join-accepted\"");
  ok = ok && contains(delivered, "u2", "\"type\":\"join-accepted\"");
  ok = ok && contains(delivered, "u2", "\"type\":\"chat-message\"");
  ok = ok && contains(delivered, "u2", "\"type\":\"signal\"");
  ok = ok && contains(delivered, "u1", "\"type\":\"kicked\"");
  ok = ok && contains(delivered, "u2", "\"type\":\"peer-left\"");

  runner.shutdown();

  if (!ok) {
    std::cerr << "[FAIL] Stub live E2E checks failed.\n";
    return 1;
  }
  std::cout << "[PASS] Stub live E2E checks passed.\n";
  return 0;
}
