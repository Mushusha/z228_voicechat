#pragma once

#include <string>

#include "transport/ws/IConnectionHub.h"
#include "transport/ws/WsRuntime.h"

namespace lvchat::transport::ws {

class WsGateway {
 public:
  WsGateway(WsRuntime& runtime, IConnectionHub& connectionHub);

  std::size_t handleConnect(const std::string& sessionId) const;
  std::size_t handleMessage(const std::string& sessionId, const std::string& rawJson) const;
  std::size_t handleDisconnect(const std::string& sessionId) const;

 private:
  WsRuntime& runtime_;
  IConnectionHub& connectionHub_;
};

}  // namespace lvchat::transport::ws
