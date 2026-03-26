#pragma once

#include "app/BackendApp.h"
#include "transport/server/IServerAdapter.h"

namespace lvchat::transport::server {

class MockServerAdapter final : public IServerAdapter {
 public:
  explicit MockServerAdapter(app::BackendApp& app);

  void start() override;
  void stop() override;
  bool isRunning() const override;

 private:
  app::BackendApp& app_;
  bool running_{false};
};

}  // namespace lvchat::transport::server
