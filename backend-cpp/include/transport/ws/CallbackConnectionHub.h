#pragma once

#include <functional>
#include <string>
#include <unordered_map>

#include "transport/ws/IConnectionHub.h"

namespace lvchat::transport::ws {

class CallbackConnectionHub final : public IConnectionHub {
 public:
  using Sender = std::function<void(const std::string&)>;

  void registerSession(const std::string& sessionId) override;
  void unregisterSession(const std::string& sessionId) override;
  bool hasSession(const std::string& sessionId) const override;
  void sendToSession(const std::string& sessionId, const std::string& payloadJson) override;

  void bindSender(const std::string& sessionId, Sender sender);

 private:
  std::unordered_map<std::string, Sender> senderBySession_;
};

}  // namespace lvchat::transport::ws
