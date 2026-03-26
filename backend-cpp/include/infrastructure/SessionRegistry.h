#pragma once

#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace lvchat::infrastructure {

class SessionRegistry {
 public:
  bool registerSession(const std::string& sessionId, const std::string& nickname);
  void unregisterSession(const std::string& sessionId);
  bool isNicknameTaken(const std::string& nickname) const;
  std::optional<std::string> findNicknameBySession(const std::string& sessionId) const;
  std::optional<std::string> findSessionByNickname(const std::string& nickname) const;
  std::vector<std::string> allSessionIds() const;
  std::vector<std::string> peersFor(const std::string& nickname) const;
  std::vector<std::string> allNicknamesSorted() const;

 private:
  std::unordered_map<std::string, std::string> nicknameBySession_;
  std::unordered_map<std::string, std::string> sessionByNickname_;
};

}  // namespace lvchat::infrastructure
