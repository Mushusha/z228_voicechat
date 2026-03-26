#pragma once

#include <cstddef>
#include <functional>
#include <mutex>
#include <string>
#include <unordered_map>

#include "app/BackendApp.h"

namespace lvchat::transport::server {

class LiveWsBridge {
 public:
  explicit LiveWsBridge(app::BackendApp& app);

  void bindSender(const std::string& sessionId, std::function<void(const std::string&)> sender);
  void unbindSender(const std::string& sessionId);

  std::size_t onSocketOpen(const std::string& sessionId);
  std::size_t onSocketMessage(const std::string& sessionId, const std::string& payloadJson);
  std::size_t onSocketClose(const std::string& sessionId);

 private:
  std::size_t flushDelivered();

  app::BackendApp& app_;
  mutable std::mutex mutex_;
  std::unordered_map<std::string, std::function<void(const std::string&)>> senderBySession_;
  std::size_t deliveredCursor_{0};
};

}  // namespace lvchat::transport::server
