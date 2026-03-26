#include <iostream>
#include "app/AppConfig.h"
#include "app/BackendApp.h"
#include "app/ServerRunner.h"
#include "transport/server/ServerAdapterFactory.h"

namespace {
void printHubDelivered(
    const std::string& label,
    const lvchat::transport::ws::InMemoryConnectionHub& hub) {
  std::cout << label << ":\n";
  for (const auto& item : hub.deliveredSnapshot()) {
    std::cout << "  * [" << item.sessionId << "] " << item.payloadJson << '\n';
  }
}

}  // namespace

int main() {
  const auto config = lvchat::app::AppConfig::fromEnv();
  lvchat::app::BackendApp app(config);
  auto adapter = lvchat::transport::server::makeServerAdapter(config, app);
  lvchat::app::ServerRunner runner(app, *adapter);

  std::cout << "health: " << app.healthJson() << '\n';
  std::cout << "bind: " << app.config().bindHost << ":" << app.config().wsPort << '\n';
  std::cout << "adapter: " << app.config().serverAdapter << '\n';
  runner.run();
  std::cout << "runner.running: " << (runner.running() ? "true" : "false") << '\n';
  app.handleConnect("session-1");
  app.handleConnect("session-2");
  app.handleMessage("session-1", "{\"type\":\"join\",\"nickname\":\"alice\"}");
  app.handleMessage("session-2", "{\"type\":\"join\",\"nickname\":\"bob\"}");
  app.handleMessage("session-1", "{\"type\":\"chat\",\"text\":\"hello from app\"}");
  app.handleMessage("session-1", "{\"type\":\"signal\",\"target\":\"bob\",\"payload\":{\"kind\":\"offer\"}}");
  app.handleMessage("session-2", "{\"type\":\"admin-kick\",\"secret\":\"admin123\",\"target\":\"alice\"}");
  app.handleDisconnect("session-2");
  runner.shutdown();
  std::cout << "runner.running: " << (runner.running() ? "true" : "false") << '\n';
  const auto stats = app.statsSnapshot();
  std::cout << "stats: connect=" << stats.connectCount << " message=" << stats.messageCount
            << " disconnect=" << stats.disconnectCount << '\n';
  printHubDelivered("backend-app-delivery", app.hub());
  return 0;
}
