#include "transport/server/LiveWsBridge.h"

namespace lvchat::transport::server {

LiveWsBridge::LiveWsBridge(app::BackendApp& app) : app_(app) {}

void LiveWsBridge::bindSender(const std::string& sessionId, std::function<void(const std::string&)> sender) {
  if (sessionId.empty()) {
    return;
  }
  std::scoped_lock lock(mutex_);
  senderBySession_[sessionId] = std::move(sender);
}

void LiveWsBridge::unbindSender(const std::string& sessionId) {
  std::scoped_lock lock(mutex_);
  senderBySession_.erase(sessionId);
}

std::size_t LiveWsBridge::onSocketOpen(const std::string& sessionId) {
  app_.handleConnect(sessionId);
  return flushDelivered();
}

std::size_t LiveWsBridge::onSocketMessage(const std::string& sessionId, const std::string& payloadJson) {
  app_.handleMessage(sessionId, payloadJson);
  return flushDelivered();
}

std::size_t LiveWsBridge::onSocketClose(const std::string& sessionId) {
  app_.handleDisconnect(sessionId);
  const auto sent = flushDelivered();
  unbindSender(sessionId);
  return sent;
}

std::size_t LiveWsBridge::flushDelivered() {
  auto& hub = app_.hubMutable();
  const auto delivered = hub.deliveredSnapshot();
  std::size_t sent = 0;
  std::scoped_lock lock(mutex_);
  while (deliveredCursor_ < delivered.size()) {
    const auto& item = delivered[deliveredCursor_++];
    const auto it = senderBySession_.find(item.sessionId);
    if (it == senderBySession_.end() || !it->second) {
      continue;
    }
    it->second(item.payloadJson);
    ++sent;
  }
  if (deliveredCursor_ > 1024U) {
    hub.eraseDeliveredPrefix(deliveredCursor_);
    deliveredCursor_ = 0;
  }
  return sent;
}

}  // namespace lvchat::transport::server
