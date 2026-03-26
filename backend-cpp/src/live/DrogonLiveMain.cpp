#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

#include <drogon/HttpAppFramework.h>
#include <drogon/HttpResponse.h>
#include <drogon/WebSocketController.h>

#include "app/AppConfig.h"
#include "app/BackendApp.h"
#include "transport/server/StubLiveServerAdapter.h"

namespace {

std::unique_ptr<lvchat::app::BackendApp> g_app;
std::unique_ptr<lvchat::transport::server::StubLiveServerAdapter> g_adapter;
std::mutex g_connMutex;
std::unordered_map<drogon::WebSocketConnectionPtr, std::string> g_sessionByConn;
std::atomic<std::size_t> g_seq{1};

std::string newSessionId() {
  return "ws-" + std::to_string(g_seq.fetch_add(1));
}

class ChatWsController final : public drogon::WebSocketController<ChatWsController> {
 public:
  void handleNewConnection(
      const drogon::HttpRequestPtr&,
      const drogon::WebSocketConnectionPtr& wsConnPtr) override {
    const std::string sessionId = newSessionId();
    {
      std::scoped_lock lock(g_connMutex);
      g_sessionByConn[wsConnPtr] = sessionId;
    }
    g_adapter->bindSessionSender(sessionId, [wsConnPtr](const std::string& payload) {
      wsConnPtr->send(payload);
    });
    g_adapter->onSocketOpen(sessionId);
  }

  void handleNewMessage(
      const drogon::WebSocketConnectionPtr& wsConnPtr,
      std::string&& message,
      const drogon::WebSocketMessageType&) override {
    std::string sessionId;
    {
      std::scoped_lock lock(g_connMutex);
      const auto it = g_sessionByConn.find(wsConnPtr);
      if (it == g_sessionByConn.end()) {
        return;
      }
      sessionId = it->second;
    }
    g_adapter->onSocketMessage(sessionId, message);
  }

  void handleConnectionClosed(const drogon::WebSocketConnectionPtr& wsConnPtr) override {
    std::string sessionId;
    {
      std::scoped_lock lock(g_connMutex);
      const auto it = g_sessionByConn.find(wsConnPtr);
      if (it == g_sessionByConn.end()) {
        return;
      }
      sessionId = it->second;
      g_sessionByConn.erase(it);
    }
    g_adapter->onSocketClose(sessionId);
  }

  WS_PATH_LIST_BEGIN
  WS_PATH_ADD("/ws", drogon::Get);
  WS_PATH_LIST_END
};

}  // namespace

int main() {
  auto cfg = lvchat::app::AppConfig::fromEnv();
  cfg.serverAdapter = "stub-live";
  g_app = std::make_unique<lvchat::app::BackendApp>(cfg);
  g_adapter = std::make_unique<lvchat::transport::server::StubLiveServerAdapter>(*g_app);
  g_adapter->start();

  drogon::app().addListener(cfg.bindHost, cfg.wsPort);
  drogon::app().setDocumentRoot(cfg.staticRoot);
  drogon::app().registerHandler(
      "/health",
      [](const drogon::HttpRequestPtr&, std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setStatusCode(drogon::k200OK);
        resp->setBody(g_app->healthJson());
        resp->addHeader("Content-Type", "application/json");
        cb(resp);
      });
  drogon::app().registerHandler(
      "/",
      [cfg](const drogon::HttpRequestPtr&, std::function<void(const drogon::HttpResponsePtr&)>&& cb) {
        cb(drogon::HttpResponse::newFileResponse(cfg.staticRoot + "/index.html"));
      });
  drogon::app().setThreadNum(1);
  drogon::app().run();

  g_adapter->stop();
  return 0;
}
