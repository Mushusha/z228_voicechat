#pragma once

#include <functional>
#include <memory>
#include <string>

#include "app/BackendApp.h"
#include "transport/server/LiveWsBridge.h"
#include "transport/server/IServerAdapter.h"

namespace lvchat::transport::server {

// Placeholder adapter for the future real WS/HTTP transport (Drogon/Beast/etc).
class StubLiveServerAdapter final : public IServerAdapter {
 public:
  explicit StubLiveServerAdapter(app::BackendApp& app);

  void start() override;
  void stop() override;
  bool isRunning() const override;

  // Integration surface for real WS framework callbacks.
  void bindSessionSender(const std::string& sessionId, std::function<void(const std::string&)> sender);
  std::size_t onSocketOpen(const std::string& sessionId);
  std::size_t onSocketMessage(const std::string& sessionId, const std::string& payloadJson);
  std::size_t onSocketClose(const std::string& sessionId);

 private:
  app::BackendApp& app_;
  bool running_{false};
  std::unique_ptr<LiveWsBridge> bridge_;
};

}  // namespace lvchat::transport::server
