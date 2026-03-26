#pragma once

#include <string>
#include <vector>

#include "transport/server/StubLiveServerAdapter.h"

namespace lvchat::transport::server {

struct HarnessDelivery {
  std::string sessionId;
  std::string payloadJson;
};

class StubLiveHarness {
 public:
  explicit StubLiveHarness(StubLiveServerAdapter& adapter);

  void attachSession(const std::string& sessionId);
  void detachSession(const std::string& sessionId);
  void pushClientMessage(const std::string& sessionId, const std::string& payloadJson);

  const std::vector<HarnessDelivery>& delivered() const;
  void clearDelivered();

 private:
  StubLiveServerAdapter& adapter_;
  std::vector<HarnessDelivery> delivered_;
};

}  // namespace lvchat::transport::server
