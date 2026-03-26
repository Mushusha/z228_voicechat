#include "transport/ws/WsRuntime.h"

namespace lvchat::transport::ws {

namespace {

std::size_t dispatchFrames(
    const std::vector<OutboundFrame>& frames,
    const std::function<void(const std::string&, const std::string&)>& deliver) {
  std::size_t count = 0;
  for (const auto& frame : frames) {
    deliver(frame.sessionId, frame.payloadJson);
    ++count;
  }
  return count;
}

}  // namespace

WsRuntime::WsRuntime(EventRouter& router, application::RoomService& roomService)
    : router_(router), roomService_(roomService) {}

std::vector<OutboundFrame> WsRuntime::onConnect(const std::string& sessionId) const {
  return {OutboundFrame{
      .sessionId = sessionId,
      .payloadJson = "{\"type\":\"hello\",\"adminPanel\":true,\"chatMessageOps\":true}"}};
}

std::vector<OutboundFrame> WsRuntime::onMessage(const std::string& sessionId, const std::string& rawJson) const {
  return expandResult(sessionId, router_.route(sessionId, rawJson));
}

std::vector<OutboundFrame> WsRuntime::onDisconnect(const std::string& sessionId) const {
  return expandResult(sessionId, router_.onDisconnect(sessionId));
}

std::size_t WsRuntime::dispatchConnect(
    const std::string& sessionId,
    const std::function<void(const std::string&, const std::string&)>& deliver) const {
  return dispatchFrames(onConnect(sessionId), deliver);
}

std::size_t WsRuntime::dispatchMessage(
    const std::string& sessionId,
    const std::string& rawJson,
    const std::function<void(const std::string&, const std::string&)>& deliver) const {
  return dispatchFrames(onMessage(sessionId, rawJson), deliver);
}

std::size_t WsRuntime::dispatchDisconnect(
    const std::string& sessionId,
    const std::function<void(const std::string&, const std::string&)>& deliver) const {
  return dispatchFrames(onDisconnect(sessionId), deliver);
}

std::vector<OutboundFrame> WsRuntime::expandResult(
    const std::string& originSessionId,
    const RouteResult& result) const {
  std::vector<OutboundFrame> frames;
  for (const auto& event : result.events) {
    if (event.scope == OutgoingEvent::Scope::Self) {
      frames.push_back(OutboundFrame{.sessionId = originSessionId, .payloadJson = event.payloadJson});
      continue;
    }
    if (event.scope == OutgoingEvent::Scope::TargetSession) {
      if (!event.targetSessionId.empty()) {
        frames.push_back(OutboundFrame{.sessionId = event.targetSessionId, .payloadJson = event.payloadJson});
      }
      continue;
    }
    const auto sessions = roomService_.allSessionIds();
    for (const auto& sessionId : sessions) {
      frames.push_back(OutboundFrame{.sessionId = sessionId, .payloadJson = event.payloadJson});
    }
  }
  return frames;
}

}  // namespace lvchat::transport::ws
