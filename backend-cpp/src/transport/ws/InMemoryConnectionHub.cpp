#include "transport/ws/InMemoryConnectionHub.h"

namespace lvchat::transport::ws {

void InMemoryConnectionHub::registerSession(const std::string& sessionId) {
  std::scoped_lock lock(mutex_);
  if (!sessionId.empty()) {
    activeSessions_.insert(sessionId);
  }
}

void InMemoryConnectionHub::unregisterSession(const std::string& sessionId) {
  std::scoped_lock lock(mutex_);
  activeSessions_.erase(sessionId);
}

bool InMemoryConnectionHub::hasSession(const std::string& sessionId) const {
  std::scoped_lock lock(mutex_);
  return activeSessions_.contains(sessionId);
}

void InMemoryConnectionHub::sendToSession(const std::string& sessionId, const std::string& payloadJson) {
  std::scoped_lock lock(mutex_);
  if (!activeSessions_.contains(sessionId)) {
    return;
  }
  delivered_.push_back(DeliveredMessage{.sessionId = sessionId, .payloadJson = payloadJson});
}

std::vector<DeliveredMessage> InMemoryConnectionHub::deliveredSnapshot() const {
  std::scoped_lock lock(mutex_);
  return delivered_;
}

void InMemoryConnectionHub::eraseDeliveredPrefix(std::size_t count) {
  std::scoped_lock lock(mutex_);
  if (count == 0U) {
    return;
  }
  if (count >= delivered_.size()) {
    delivered_.clear();
    return;
  }
  delivered_.erase(delivered_.begin(), delivered_.begin() + static_cast<long long>(count));
}

void InMemoryConnectionHub::clearDelivered() {
  std::scoped_lock lock(mutex_);
  delivered_.clear();
}

}  // namespace lvchat::transport::ws
