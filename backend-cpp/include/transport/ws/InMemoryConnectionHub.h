#pragma once

#include <mutex>
#include <string>
#include <unordered_set>
#include <vector>

#include "transport/ws/IConnectionHub.h"

namespace lvchat::transport::ws {

struct DeliveredMessage {
  std::string sessionId;
  std::string payloadJson;
};

class InMemoryConnectionHub final : public IConnectionHub {
 public:
  void registerSession(const std::string& sessionId) override;
  void unregisterSession(const std::string& sessionId) override;
  bool hasSession(const std::string& sessionId) const override;
  void sendToSession(const std::string& sessionId, const std::string& payloadJson) override;

  std::vector<DeliveredMessage> deliveredSnapshot() const;
  void eraseDeliveredPrefix(std::size_t count);
  void clearDelivered();

 private:
  mutable std::mutex mutex_;
  std::unordered_set<std::string> activeSessions_;
  std::vector<DeliveredMessage> delivered_;
};

}  // namespace lvchat::transport::ws
