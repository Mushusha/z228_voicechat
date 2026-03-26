#include "app/AppConfig.h"

#include <cstdlib>

namespace lvchat::app {

namespace {

std::string envOrDefault(const char* key, const std::string& fallback) {
  const char* value = std::getenv(key);
  if (value == nullptr || *value == '\0') {
    return fallback;
  }
  return std::string(value);
}

int intEnvOrDefault(const char* key, int fallback) {
  const char* value = std::getenv(key);
  if (value == nullptr || *value == '\0') {
    return fallback;
  }
  try {
    return std::stoi(value);
  } catch (...) {
    return fallback;
  }
}

}  // namespace

AppConfig AppConfig::fromEnv() {
  AppConfig cfg;
  cfg.adminPassword = envOrDefault("ADMIN_PANEL_PASSWORD", cfg.adminPassword);
  cfg.serviceName = envOrDefault("SERVICE_NAME", cfg.serviceName);
  cfg.bindHost = envOrDefault("BIND_HOST", cfg.bindHost);
  cfg.wsPort = intEnvOrDefault("PORT", cfg.wsPort);
  cfg.serverAdapter = envOrDefault("SERVER_ADAPTER", cfg.serverAdapter);
  return cfg;
}

}  // namespace lvchat::app
