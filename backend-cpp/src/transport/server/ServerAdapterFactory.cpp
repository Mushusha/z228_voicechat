#include "transport/server/ServerAdapterFactory.h"

#include "transport/server/MockServerAdapter.h"
#include "transport/server/StubLiveServerAdapter.h"

namespace lvchat::transport::server {

std::unique_ptr<IServerAdapter> makeServerAdapter(
    const app::AppConfig& config,
    app::BackendApp& app) {
  if (config.serverAdapter == "stub-live") {
    return std::make_unique<StubLiveServerAdapter>(app);
  }
  return std::make_unique<MockServerAdapter>(app);
}

}  // namespace lvchat::transport::server
