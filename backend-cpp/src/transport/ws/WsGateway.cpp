#include "transport/ws/WsGateway.h"

namespace lvchat::transport::ws {

WsGateway::WsGateway(WsRuntime& runtime, IConnectionHub& connectionHub)
    : runtime_(runtime), connectionHub_(connectionHub) {}

std::size_t WsGateway::handleConnect(const std::string& sessionId) const {
  connectionHub_.registerSession(sessionId);
  return runtime_.dispatchConnect(sessionId, [&](const std::string& to, const std::string& payload) {
    connectionHub_.sendToSession(to, payload);
  });
}

std::size_t WsGateway::handleMessage(const std::string& sessionId, const std::string& rawJson) const {
  if (!connectionHub_.hasSession(sessionId)) {
    return 0;
  }
  return runtime_.dispatchMessage(sessionId, rawJson, [&](const std::string& to, const std::string& payload) {
    connectionHub_.sendToSession(to, payload);
  });
}

std::size_t WsGateway::handleDisconnect(const std::string& sessionId) const {
  const auto sent = runtime_.dispatchDisconnect(sessionId, [&](const std::string& to, const std::string& payload) {
    connectionHub_.sendToSession(to, payload);
  });
  connectionHub_.unregisterSession(sessionId);
  return sent;
}

}  // namespace lvchat::transport::ws
