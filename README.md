# zalupa228local

Локальный голосовой чат в браузере: WebRTC mesh + WebSocket signaling + текстовый чат.

Текущий бэкенд написан на Go. При доступной MongoDB история сообщений хранится в базе; при недоступной Mongo сервер автоматически уходит в in-memory режим (до перезапуска процесса).

## Требования

- Go 1.23+
- Браузер с поддержкой WebRTC (Chrome/Edge/Firefox)
- MongoDB (опционально, для постоянной истории)

## Быстрый запуск локально (без Docker)

Из корня репозитория:

1. (Опционально) подними MongoDB или задай `MONGODB_URI`.
2. Собери бинарник:
   - `env GOPATH="$PWD/.go/gopath" GOMODCACHE="$PWD/.go/modcache" GOCACHE="$PWD/.go/cache" go build -o bin/z228_server ./cmd/server`
3. Запусти сервер:
   - `env GOPATH="$PWD/.go/gopath" GOMODCACHE="$PWD/.go/modcache" GOCACHE="$PWD/.go/cache" ./bin/z228_server`

Сервер слушает:

- HTTP: `http://127.0.0.1:3000` (или `PORT`)
- HTTPS: `https://127.0.0.1:3443` (или `HTTPS_PORT`, `0` чтобы отключить)

## Переменные окружения

- `PORT` (по умолчанию `3000`)
- `HTTPS_PORT` (по умолчанию `3443`, `0` отключает HTTPS)
- `LISTEN_HOST` (по умолчанию `::`, dual-stack IPv4/IPv6)
- `MONGODB_URI` (по умолчанию `mongodb://127.0.0.1:27017/zalupa228local`)
- `ADMIN_PANEL_PASSWORD` (по умолчанию `admin123`)
- `CERT_EXTRA_IPS` (доп. IP для SAN self-signed сертификата, через запятую)

## Подключение клиентов

На этом же ПК:

- `http://localhost:3000` или `http://127.0.0.1:3000`

С другого телефона/ПК в той же сети:

- `https://<host-ip>:3443`

HTTP по LAN-IP обычно откроет страницу, но микрофон браузер часто блокирует без HTTPS.

## Как использовать

1. Введи уникальный `nickname` и нажми `Join`.
2. Разреши доступ к микрофону.
3. Кнопка микрофона включает/выключает отправку аудио.
4. В списке участников можно локально выключить звук конкретного собеседника.
5. В чате доступны сообщения, редактирование, удаление и реакции.

## Docker (приложение + MongoDB)

Нужны [Docker](https://docs.docker.com/get-docker/) и Docker Compose.

Из корня проекта:

- `docker compose up --build`
- или PowerShell: `.\scripts\run-docker.ps1`
- или Linux/macOS: `chmod +x scripts/run-docker.sh && ./scripts/run-docker.sh`

Порты приложения наружу: `3000` (HTTP) и `3443` (HTTPS). Mongo доступна только внутри сети compose.

Если нужен доступ с телефона по `https://<LAN-IP>:3443`, добавь LAN IP в сертификат:

- PowerShell: `.\scripts\run-docker.ps1 -LanIp 192.168.0.199`
- bash: `LAN_IP=192.168.0.199 ./scripts/run-docker.sh`
- вручную через `CERT_EXTRA_IPS`

## Smoke test WebSocket

Есть небольшой локальный тест:

- `go run ./tools/ws_smoketest`

Он проверяет базовый поток: `hello -> join -> chat-history -> chat -> react -> edit -> delete`.
