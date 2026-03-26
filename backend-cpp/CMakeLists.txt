cmake_minimum_required(VERSION 3.20)
project(local_voicechat_backend_cpp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
option(ENABLE_DROGON_LIVE "Build real drogon live server target" OFF)

add_executable(local_voicechat_backend
    src/main.cpp
    src/app/AppConfig.cpp
    src/app/BackendApp.cpp
    src/app/ServerRunner.cpp
    src/application/ChatService.cpp
    src/application/RoomService.cpp
    src/application/SignalingService.cpp
    src/infrastructure/MemoryChatRepository.cpp
    src/infrastructure/SessionRegistry.cpp
    src/transport/ws/EventRouter.cpp
    src/transport/ws/CallbackConnectionHub.cpp
    src/transport/ws/InMemoryConnectionHub.cpp
    src/transport/ws/WsGateway.cpp
    src/transport/ws/WsRuntime.cpp
    src/transport/server/MockServerAdapter.cpp
    src/transport/server/LiveWsBridge.cpp
    src/transport/server/StubLiveServerAdapter.cpp
    src/transport/server/ServerAdapterFactory.cpp
)

target_include_directories(local_voicechat_backend
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

add_executable(local_voicechat_contract_smoke
    src/tests/ContractSmoke.cpp
    src/app/AppConfig.cpp
    src/app/BackendApp.cpp
    src/app/ServerRunner.cpp
    src/application/ChatService.cpp
    src/application/RoomService.cpp
    src/application/SignalingService.cpp
    src/infrastructure/MemoryChatRepository.cpp
    src/infrastructure/SessionRegistry.cpp
    src/transport/ws/EventRouter.cpp
    src/transport/ws/InMemoryConnectionHub.cpp
    src/transport/ws/WsGateway.cpp
    src/transport/ws/WsRuntime.cpp
    src/transport/server/MockServerAdapter.cpp
    src/transport/server/LiveWsBridge.cpp
    src/transport/server/StubLiveServerAdapter.cpp
    src/transport/server/ServerAdapterFactory.cpp
)

target_include_directories(local_voicechat_contract_smoke
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

add_executable(local_voicechat_stub_live_e2e
    src/tests/StubLiveE2E.cpp
    src/app/AppConfig.cpp
    src/app/BackendApp.cpp
    src/app/ServerRunner.cpp
    src/application/ChatService.cpp
    src/application/RoomService.cpp
    src/application/SignalingService.cpp
    src/infrastructure/MemoryChatRepository.cpp
    src/infrastructure/SessionRegistry.cpp
    src/transport/ws/EventRouter.cpp
    src/transport/ws/InMemoryConnectionHub.cpp
    src/transport/ws/WsGateway.cpp
    src/transport/ws/WsRuntime.cpp
    src/transport/server/MockServerAdapter.cpp
    src/transport/server/LiveWsBridge.cpp
    src/transport/server/StubLiveServerAdapter.cpp
    src/transport/server/ServerAdapterFactory.cpp
    src/transport/server/StubLiveHarness.cpp
)

target_include_directories(local_voicechat_stub_live_e2e
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

add_executable(local_voicechat_ws_event_contract
    src/tests/WsEventContractE2E.cpp
    src/app/AppConfig.cpp
    src/app/BackendApp.cpp
    src/app/ServerRunner.cpp
    src/application/ChatService.cpp
    src/application/RoomService.cpp
    src/application/SignalingService.cpp
    src/infrastructure/MemoryChatRepository.cpp
    src/infrastructure/SessionRegistry.cpp
    src/transport/ws/EventRouter.cpp
    src/transport/ws/InMemoryConnectionHub.cpp
    src/transport/ws/WsGateway.cpp
    src/transport/ws/WsRuntime.cpp
    src/transport/server/MockServerAdapter.cpp
    src/transport/server/LiveWsBridge.cpp
    src/transport/server/StubLiveServerAdapter.cpp
    src/transport/server/ServerAdapterFactory.cpp
    src/transport/server/StubLiveHarness.cpp
)

target_include_directories(local_voicechat_ws_event_contract
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

add_executable(local_voicechat_frontend_compat_e2e
    src/tests/FrontendCompatE2E.cpp
    src/app/AppConfig.cpp
    src/app/BackendApp.cpp
    src/app/ServerRunner.cpp
    src/application/ChatService.cpp
    src/application/RoomService.cpp
    src/application/SignalingService.cpp
    src/infrastructure/MemoryChatRepository.cpp
    src/infrastructure/SessionRegistry.cpp
    src/transport/ws/EventRouter.cpp
    src/transport/ws/InMemoryConnectionHub.cpp
    src/transport/ws/WsGateway.cpp
    src/transport/ws/WsRuntime.cpp
    src/transport/server/MockServerAdapter.cpp
    src/transport/server/LiveWsBridge.cpp
    src/transport/server/StubLiveServerAdapter.cpp
    src/transport/server/ServerAdapterFactory.cpp
    src/transport/server/StubLiveHarness.cpp
)

target_include_directories(local_voicechat_frontend_compat_e2e
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

if(ENABLE_DROGON_LIVE)
    find_package(Drogon CONFIG REQUIRED)

    add_executable(local_voicechat_drogon_live
        src/live/DrogonLiveMain.cpp
        src/app/AppConfig.cpp
        src/app/BackendApp.cpp
        src/app/ServerRunner.cpp
        src/application/ChatService.cpp
        src/application/RoomService.cpp
        src/application/SignalingService.cpp
        src/infrastructure/MemoryChatRepository.cpp
        src/infrastructure/SessionRegistry.cpp
        src/transport/ws/EventRouter.cpp
        src/transport/ws/InMemoryConnectionHub.cpp
        src/transport/ws/WsGateway.cpp
        src/transport/ws/WsRuntime.cpp
        src/transport/server/LiveWsBridge.cpp
        src/transport/server/StubLiveServerAdapter.cpp
    )

    target_include_directories(local_voicechat_drogon_live
        PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/include
    )
    target_link_libraries(local_voicechat_drogon_live PRIVATE Drogon::Drogon)
endif()

# TODO: add Drogon and mongocxx packages here when wiring runtime dependencies.
