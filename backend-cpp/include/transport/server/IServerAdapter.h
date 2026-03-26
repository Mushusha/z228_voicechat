#pragma once

namespace lvchat::transport::server {

class IServerAdapter {
 public:
  virtual ~IServerAdapter() = default;

  virtual void start() = 0;
  virtual void stop() = 0;
  virtual bool isRunning() const = 0;
};

}  // namespace lvchat::transport::server
