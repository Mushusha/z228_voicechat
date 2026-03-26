#pragma once

#include <memory>

#include "app/AppConfig.h"
#include "app/BackendApp.h"
#include "transport/server/IServerAdapter.h"

namespace lvchat::transport::server {

std::unique_ptr<IServerAdapter> makeServerAdapter(
    const app::AppConfig& config,
    app::BackendApp& app);

}  // namespace lvchat::transport::server
