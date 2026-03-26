#include "application/RoomService.h"

namespace lvchat::application {

RoomService::RoomService(infrastructure::SessionRegistry& sessions) : sessions_(sessions) {}

JoinResult RoomService::join(const std::string& sessionId, const std::string& nickname) {
  if (nickname.empty()) {
    return JoinResult{.ok = false, .reason = "Nickname is required."};
  }
  if (sessions_.findNicknameBySession(sessionId).has_value()) {
    return JoinResult{.ok = false, .reason = "Already joined."};
  }
  if (sessions_.isNicknameTaken(nickname)) {
    return JoinResult{.ok = false, .reason = "Nickname already taken."};
  }
  if (!sessions_.registerSession(sessionId, nickname)) {
    return JoinResult{.ok = false, .reason = "Cannot register user."};
  }
  JoinResult result;
  result.ok = true;
  result.nickname = nickname;
  result.peers = sessions_.peersFor(nickname);
  return result;
}

void RoomService::leave(const std::string& sessionId) {
  sessions_.unregisterSession(sessionId);
}

bool RoomService::ensureJoined(const std::string& sessionId) const {
  return sessions_.findNicknameBySession(sessionId).has_value();
}

std::string RoomService::nicknameFor(const std::string& sessionId) const {
  const auto nickname = sessions_.findNicknameBySession(sessionId);
  return nickname.has_value() ? *nickname : "";
}

std::optional<std::string> RoomService::sessionForNickname(const std::string& nickname) const {
  return sessions_.findSessionByNickname(nickname);
}

std::vector<std::string> RoomService::allSessionIds() const {
  return sessions_.allSessionIds();
}

std::vector<std::string> RoomService::adminPeers() const {
  return sessions_.allNicknamesSorted();
}

AdminKickResult RoomService::adminKick(const std::string& targetNickname) {
  const auto session = sessions_.findSessionByNickname(targetNickname);
  if (!session.has_value()) {
    return AdminKickResult{.ok = false, .reason = "Participant not found."};
  }
  sessions_.unregisterSession(*session);
  return AdminKickResult{.ok = true, .kickedNickname = targetNickname, .kickedSessionId = *session};
}

}  // namespace lvchat::application
