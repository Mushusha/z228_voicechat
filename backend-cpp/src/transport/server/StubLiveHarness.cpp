#include "transport/server/StubLiveHarness.h"

namespace lvchat::transport::server {

StubLiveHarness::StubLiveHarness(StubLiveServerAdapter& adapter) : adapter_(adapter) {}

void StubLiveHarness::attachSession(const std::string& sessionId) {
  adapter_.bindSessionSender(sessionId, [this, sessionId](const std::string& payload) {
    delivered_.push_back(HarnessDelivery{.sessionId = sessionId, .payloadJson = payload});
  });
  adapter_.onSocketOpen(sessionId);
}

void StubLiveHarness::detachSession(const std::string& sessionId) {
  adapter_.onSocketClose(sessionId);
}

void StubLiveHarness::pushClientMessage(const std::string& sessionId, const std::string& payloadJson) {
  adapter_.onSocketMessage(sessionId, payloadJson);
}

const std::vector<HarnessDelivery>& StubLiveHarness::delivered() const {
  return delivered_;
}

void StubLiveHarness::clearDelivered() {
  delivered_.clear();
}

}  // namespace lvchat::transport::server
