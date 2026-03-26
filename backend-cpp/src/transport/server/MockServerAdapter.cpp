#include "transport/server/MockServerAdapter.h"

namespace lvchat::transport::server {

MockServerAdapter::MockServerAdapter(app::BackendApp& app) : app_(app) {}

void MockServerAdapter::start() {
  if (running_) {
    return;
  }
  running_ = true;

  // deterministic smoke startup sequence
  app_.handleConnect("srv-s1");
  app_.handleConnect("srv-s2");
  app_.handleMessage("srv-s1", "{\"type\":\"join\",\"nickname\":\"service-alice\"}");
  app_.handleMessage("srv-s2", "{\"type\":\"join\",\"nickname\":\"service-bob\"}");
}

void MockServerAdapter::stop() {
  if (!running_) {
    return;
  }
  app_.handleDisconnect("srv-s1");
  app_.handleDisconnect("srv-s2");
  running_ = false;
}

bool MockServerAdapter::isRunning() const {
  return running_;
}

}  // namespace lvchat::transport::server
