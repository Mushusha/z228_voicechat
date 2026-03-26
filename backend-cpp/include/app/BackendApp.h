#pragma once

#include <atomic>
#include <chrono>
#include <memory>
#include <string>

#include "app/AppConfig.h"
#include "application/ChatService.h"
#include "application/RoomService.h"
#include "application/SignalingService.h"
#include "infrastructure/MemoryChatRepository.h"
#include "infrastructure/SessionRegistry.h"
#include "transport/ws/EventRouter.h"
#include "transport/ws/InMemoryConnectionHub.h"
#include "transport/ws/WsGateway.h"
#include "transport/ws/WsRuntime.h"

namespace lvchat::app {

struct RuntimeStats {
  std::size_t connectCount{0};
  std::size_t messageCount{0};
  std::size_t disconnectCount{0};
};

class BackendApp {
 public:
  explicit BackendApp(AppConfig config);

  std::size_t handleConnect(const std::string& sessionId);
  std::size_t handleMessage(const std::string& sessionId, const std::string& rawJson);
  std::size_t handleDisconnect(const std::string& sessionId);

  const transport::ws::InMemoryConnectionHub& hub() const;
  transport::ws::InMemoryConnectionHub& hubMutable();
  std::string healthJson() const;
  RuntimeStats statsSnapshot() const;
  const AppConfig& config() const;

 private:
  AppConfig config_;
  std::shared_ptr<infrastructure::MemoryChatRepository> repository_;
  infrastructure::SessionRegistry sessions_;
  application::ChatService chatService_;
  application::RoomService roomService_;
  application::SignalingService signalingService_;
  transport::ws::EventRouter router_;
  transport::ws::WsRuntime runtime_;
  transport::ws::InMemoryConnectionHub hub_;
  transport::ws::WsGateway gateway_;
  std::chrono::steady_clock::time_point startedAt_;
  std::atomic<std::size_t> connectCount_{0};
  std::atomic<std::size_t> messageCount_{0};
  std::atomic<std::size_t> disconnectCount_{0};
};

}  // namespace lvchat::app
