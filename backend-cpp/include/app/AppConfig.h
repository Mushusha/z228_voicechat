#pragma once

#include <string>

namespace lvchat::app {

struct AppConfig {
  std::string adminPassword = "admin123";
  std::string serviceName = "local_voicechat_backend_cpp";
  std::string bindHost = "0.0.0.0";
  int wsPort = 3000;
  std::string serverAdapter = "mock";
  std::string staticRoot = "server/public";

  static AppConfig fromEnv();
};

}  // namespace lvchat::app
