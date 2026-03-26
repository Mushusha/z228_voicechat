#pragma once

#include <string>

namespace lvchat::transport::ws {

class IConnectionHub {
 public:
  virtual ~IConnectionHub() = default;

  virtual void registerSession(const std::string& sessionId) = 0;
  virtual void unregisterSession(const std::string& sessionId) = 0;
  virtual bool hasSession(const std::string& sessionId) const = 0;
  virtual void sendToSession(const std::string& sessionId, const std::string& payloadJson) = 0;
};

}  // namespace lvchat::transport::ws
