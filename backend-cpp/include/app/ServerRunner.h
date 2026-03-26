#pragma once

#include "app/BackendApp.h"
#include "transport/server/IServerAdapter.h"

namespace lvchat::app {

class ServerRunner {
 public:
  ServerRunner(BackendApp& app, transport::server::IServerAdapter& adapter);

  void run();
  void shutdown();
  bool running() const;

 private:
  BackendApp& app_;
  transport::server::IServerAdapter& adapter_;
};

}  // namespace lvchat::app
