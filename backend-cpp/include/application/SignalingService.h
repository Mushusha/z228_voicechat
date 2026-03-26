#pragma once

#include <string>

namespace lvchat::application {

class SignalingService {
 public:
  // Relay payloads between peers while keeping transport-independent semantics.
  std::string buildRelayEvent(
      const std::string& fromNickname,
      const std::string& toNickname,
      const std::string& payloadJson) const;
};

}  // namespace lvchat::application
