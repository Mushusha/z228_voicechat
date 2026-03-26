#include "transport/server/StubLiveServerAdapter.h"

namespace lvchat::transport::server {

StubLiveServerAdapter::StubLiveServerAdapter(app::BackendApp& app) : app_(app) {}

void StubLiveServerAdapter::start() {
  if (running_) {
    return;
  }
  running_ = true;
  bridge_ = std::make_unique<LiveWsBridge>(app_);
}

void StubLiveServerAdapter::stop() {
  bridge_.reset();
  running_ = false;
}

bool StubLiveServerAdapter::isRunning() const {
  return running_;
}

void StubLiveServerAdapter::bindSessionSender(
    const std::string& sessionId,
    std::function<void(const std::string&)> sender) {
  if (!bridge_) {
    return;
  }
  bridge_->bindSender(sessionId, std::move(sender));
}

std::size_t StubLiveServerAdapter::onSocketOpen(const std::string& sessionId) {
  if (!bridge_) {
    return 0;
  }
  return bridge_->onSocketOpen(sessionId);
}

std::size_t StubLiveServerAdapter::onSocketMessage(
    const std::string& sessionId,
    const std::string& payloadJson) {
  if (!bridge_) {
    return 0;
  }
  return bridge_->onSocketMessage(sessionId, payloadJson);
}

std::size_t StubLiveServerAdapter::onSocketClose(const std::string& sessionId) {
  if (!bridge_) {
    return 0;
  }
  return bridge_->onSocketClose(sessionId);
}

}  // namespace lvchat::transport::server
