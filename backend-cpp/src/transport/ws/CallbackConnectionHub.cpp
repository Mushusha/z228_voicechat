#include "transport/ws/CallbackConnectionHub.h"

namespace lvchat::transport::ws {

void CallbackConnectionHub::registerSession(const std::string& sessionId) {
  if (sessionId.empty()) {
    return;
  }
  senderBySession_.try_emplace(sessionId, nullptr);
}

void CallbackConnectionHub::unregisterSession(const std::string& sessionId) {
  senderBySession_.erase(sessionId);
}

bool CallbackConnectionHub::hasSession(const std::string& sessionId) const {
  return senderBySession_.contains(sessionId);
}

void CallbackConnectionHub::sendToSession(const std::string& sessionId, const std::string& payloadJson) {
  const auto it = senderBySession_.find(sessionId);
  if (it == senderBySession_.end()) {
    return;
  }
  const auto& sender = it->second;
  if (!sender) {
    return;
  }
  sender(payloadJson);
}

void CallbackConnectionHub::bindSender(const std::string& sessionId, Sender sender) {
  if (sessionId.empty()) {
    return;
  }
  senderBySession_[sessionId] = std::move(sender);
}

}  // namespace lvchat::transport::ws
