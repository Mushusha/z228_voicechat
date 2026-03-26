#pragma once

#include <functional>
#include <string>
#include <vector>

#include "application/RoomService.h"
#include "transport/ws/EventRouter.h"

namespace lvchat::transport::ws {

struct OutboundFrame {
  std::string sessionId;
  std::string payloadJson;
};

class WsRuntime {
 public:
  WsRuntime(EventRouter& router, application::RoomService& roomService);

  std::vector<OutboundFrame> onConnect(const std::string& sessionId) const;
  std::vector<OutboundFrame> onMessage(const std::string& sessionId, const std::string& rawJson) const;
  std::vector<OutboundFrame> onDisconnect(const std::string& sessionId) const;
  std::size_t dispatchConnect(
      const std::string& sessionId,
      const std::function<void(const std::string&, const std::string&)>& deliver) const;
  std::size_t dispatchMessage(
      const std::string& sessionId,
      const std::string& rawJson,
      const std::function<void(const std::string&, const std::string&)>& deliver) const;
  std::size_t dispatchDisconnect(
      const std::string& sessionId,
      const std::function<void(const std::string&, const std::string&)>& deliver) const;

 private:
  std::vector<OutboundFrame> expandResult(
      const std::string& originSessionId,
      const RouteResult& result) const;

  EventRouter& router_;
  application::RoomService& roomService_;
};

}  // namespace lvchat::transport::ws
