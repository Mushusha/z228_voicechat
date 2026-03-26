#pragma once

#include <string>
#include <vector>

#include "application/ChatService.h"
#include "application/RoomService.h"
#include "application/SignalingService.h"

namespace lvchat::transport::ws {

struct OutgoingEvent {
  enum class Scope {
    Self,
    Broadcast,
    TargetSession
  };

  Scope scope{Scope::Self};
  std::string targetSessionId;
  std::string payloadJson;
};

struct RouteResult {
  std::vector<OutgoingEvent> events;
};

class EventRouter {
 public:
  EventRouter(
      application::ChatService& chatService,
      application::RoomService& roomService,
      application::SignalingService& signalingService,
      std::string adminSecret);

  RouteResult route(const std::string& sessionId, const std::string& rawJson) const;
  RouteResult onDisconnect(const std::string& sessionId) const;

 private:
  static std::string extractString(const std::string& rawJson, const std::string& key);
  static std::string extractRawValue(const std::string& rawJson, const std::string& key);
  static std::string escapeJson(const std::string& value);
  static std::string normalizeType(const std::string& rawType);

  application::ChatService& chatService_;
  application::RoomService& roomService_;
  application::SignalingService& signalingService_;
  std::string adminSecret_;
};

}  // namespace lvchat::transport::ws
