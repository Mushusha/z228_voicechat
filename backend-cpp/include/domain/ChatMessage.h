#pragma once

#include <chrono>
#include <string>
#include <unordered_map>
#include <vector>

namespace lvchat::domain {

struct ChatMessage {
  std::string id;
  std::string nickname;
  std::string text;
  std::string imageMime;
  std::string imageData;
  std::unordered_map<std::string, std::vector<std::string>> reactions;
  std::chrono::system_clock::time_point createdAt{};
};

}  // namespace lvchat::domain
