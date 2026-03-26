#pragma once

#include <optional>
#include <string>
#include <vector>

#include "infrastructure/SessionRegistry.h"

namespace lvchat::application {

struct JoinResult {
  bool ok{false};
  std::string reason;
  std::string nickname;
  std::vector<std::string> peers;
};

struct AdminKickResult {
  bool ok{false};
  std::string reason;
  std::string kickedNickname;
  std::string kickedSessionId;
};

class RoomService {
 public:
  explicit RoomService(infrastructure::SessionRegistry& sessions);

  JoinResult join(const std::string& sessionId, const std::string& nickname);
  void leave(const std::string& sessionId);
  bool ensureJoined(const std::string& sessionId) const;
  std::string nicknameFor(const std::string& sessionId) const;
  std::optional<std::string> sessionForNickname(const std::string& nickname) const;
  std::vector<std::string> allSessionIds() const;
  std::vector<std::string> adminPeers() const;
  AdminKickResult adminKick(const std::string& targetNickname);

 private:
  infrastructure::SessionRegistry& sessions_;
};

}  // namespace lvchat::application
