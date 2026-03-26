# local-voicechat (C++ only)

Локальный голосовой чат в браузере: WebRTC mesh + WebSocket signaling + текстовый чат.

Проект запускается **только через C++ сервер** (`Drogon`).

## Быстрый старт

1. В корне проекта собрать live сервер:
   - `npm run cpp:build-live`
2. Запустить live сервер:
   - `npm run cpp:run-live`
3. Открыть фронт:
   - `http://127.0.0.1:3010`
4. Проверка health:
   - `http://127.0.0.1:3010/health`

## Тесты совместимости

- `npm run cpp:test:compat`

Команда запускает:
- `local_voicechat_contract_smoke`
- `local_voicechat_stub_live_e2e`
- `local_voicechat_ws_event_contract`
- `local_voicechat_frontend_compat_e2e`

## Переменные окружения

- `ADMIN_PANEL_PASSWORD` (по умолчанию `admin123`)
- `SERVICE_NAME` (по умолчанию `local_voicechat_backend_cpp`)
- `BIND_HOST` (по умолчанию `0.0.0.0`)
- `PORT` (по умолчанию `3010` для `npm run cpp:run-live`)
- `SERVER_ADAPTER` (`mock` или `stub-live`, для live используется `stub-live`)
- `STATIC_ROOT` (по умолчанию `server/public`)

## Маршруты live сервера

- `GET /` -> `server/public/index.html`
- `GET /health` -> health JSON
- `WS /ws` -> signaling/chat websocket
