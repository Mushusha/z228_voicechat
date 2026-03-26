#include "app/ServerRunner.h"

namespace lvchat::app {

ServerRunner::ServerRunner(BackendApp& app, transport::server::IServerAdapter& adapter)
    : app_(app), adapter_(adapter) {}

void ServerRunner::run() {
  (void)app_;
  adapter_.start();
}

void ServerRunner::shutdown() {
  adapter_.stop();
}

bool ServerRunner::running() const {
  return adapter_.isRunning();
}

}  // namespace lvchat::app
