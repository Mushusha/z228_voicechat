#include "application/SignalingService.h"

#include <sstream>

namespace lvchat::application {

std::string SignalingService::buildRelayEvent(
    const std::string& fromNickname,
    const std::string& toNickname,
    const std::string& payloadJson) const {
  std::ostringstream out;
  out << "{\"type\":\"signal\",\"from\":\"" << fromNickname << "\",\"to\":\"" << toNickname
      << "\",\"payload\":" << payloadJson << "}";
  return out.str();
}

}  // namespace lvchat::application
