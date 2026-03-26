#include "infrastructure/SessionRegistry.h"

#include <algorithm>

namespace lvchat::infrastructure {

bool SessionRegistry::registerSession(const std::string& sessionId, const std::string& nickname) {
  if (sessionId.empty() || nickname.empty() || sessionByNickname_.contains(nickname) ||
      nicknameBySession_.contains(sessionId)) {
    return false;
  }
  nicknameBySession_[sessionId] = nickname;
  sessionByNickname_[nickname] = sessionId;
  return true;
}

void SessionRegistry::unregisterSession(const std::string& sessionId) {
  const auto it = nicknameBySession_.find(sessionId);
  if (it == nicknameBySession_.end()) {
    return;
  }
  sessionByNickname_.erase(it->second);
  nicknameBySession_.erase(it);
}

bool SessionRegistry::isNicknameTaken(const std::string& nickname) const {
  return sessionByNickname_.contains(nickname);
}

std::optional<std::string> SessionRegistry::findNicknameBySession(const std::string& sessionId) const {
  const auto it = nicknameBySession_.find(sessionId);
  if (it == nicknameBySession_.end()) {
    return std::nullopt;
  }
  return it->second;
}

std::optional<std::string> SessionRegistry::findSessionByNickname(const std::string& nickname) const {
  const auto it = sessionByNickname_.find(nickname);
  if (it == sessionByNickname_.end()) {
    return std::nullopt;
  }
  return it->second;
}

std::vector<std::string> SessionRegistry::allSessionIds() const {
  std::vector<std::string> out;
  out.reserve(nicknameBySession_.size());
  for (const auto& [sessionId, _] : nicknameBySession_) {
    out.push_back(sessionId);
  }
  std::sort(out.begin(), out.end());
  return out;
}

std::vector<std::string> SessionRegistry::peersFor(const std::string& nickname) const {
  std::vector<std::string> out;
  out.reserve(sessionByNickname_.size());
  for (const auto& [name, _] : sessionByNickname_) {
    if (name != nickname) {
      out.push_back(name);
    }
  }
  std::sort(out.begin(), out.end());
  return out;
}

std::vector<std::string> SessionRegistry::allNicknamesSorted() const {
  std::vector<std::string> out;
  out.reserve(sessionByNickname_.size());
  for (const auto& [name, _] : sessionByNickname_) {
    out.push_back(name);
  }
  std::sort(out.begin(), out.end());
  return out;
}

}  // namespace lvchat::infrastructure
