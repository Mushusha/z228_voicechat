#include "app/BackendApp.h"

namespace lvchat::app {

BackendApp::BackendApp(AppConfig config)
    : config_(std::move(config)),
      repository_(std::make_shared<infrastructure::MemoryChatRepository>()),
      sessions_(),
      chatService_(repository_),
      roomService_(sessions_),
      signalingService_(),
      router_(chatService_, roomService_, signalingService_, config_.adminPassword),
      runtime_(router_, roomService_),
      hub_(),
      gateway_(runtime_, hub_),
      startedAt_(std::chrono::steady_clock::now()) {}

std::size_t BackendApp::handleConnect(const std::string& sessionId) {
  ++connectCount_;
  return gateway_.handleConnect(sessionId);
}

std::size_t BackendApp::handleMessage(const std::string& sessionId, const std::string& rawJson) {
  ++messageCount_;
  return gateway_.handleMessage(sessionId, rawJson);
}

std::size_t BackendApp::handleDisconnect(const std::string& sessionId) {
  ++disconnectCount_;
  return gateway_.handleDisconnect(sessionId);
}

const transport::ws::InMemoryConnectionHub& BackendApp::hub() const {
  return hub_;
}

transport::ws::InMemoryConnectionHub& BackendApp::hubMutable() {
  return hub_;
}

std::string BackendApp::healthJson() const {
  const auto stats = statsSnapshot();
  const auto uptimeSeconds = std::chrono::duration_cast<std::chrono::seconds>(
                                 std::chrono::steady_clock::now() - startedAt_)
                                 .count();
  return "{\"status\":\"ok\",\"service\":\"" + config_.serviceName + "\",\"port\":" + std::to_string(config_.wsPort) +
         ",\"uptimeSec\":" + std::to_string(uptimeSeconds) + ",\"stats\":{\"connect\":" +
         std::to_string(stats.connectCount) + ",\"message\":" + std::to_string(stats.messageCount) +
         ",\"disconnect\":" + std::to_string(stats.disconnectCount) + "}}";
}

RuntimeStats BackendApp::statsSnapshot() const {
  return RuntimeStats{
      .connectCount = connectCount_.load(),
      .messageCount = messageCount_.load(),
      .disconnectCount = disconnectCount_.load()};
}

const AppConfig& BackendApp::config() const {
  return config_;
}

}  // namespace lvchat::app
