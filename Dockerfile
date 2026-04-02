FROM golang:1.23-alpine AS build

# Low-RAM VPS (~1GB): default parallel compile uses a lot of memory; cap workers.
ENV CGO_ENABLED=0 \
    GOOS=linux \
    GOMAXPROCS=1 \
    GOGC=50

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
COPY server ./server

# -p 1: one package at a time (slower, much less RAM than default parallelism).
RUN mkdir -p /out && \
    go build -p 1 -trimpath -ldflags="-s -w" -o /out/z228_server ./cmd/server

FROM alpine:3.20

WORKDIR /app

COPY --from=build /out/z228_server /app/z228_server
COPY server /app/server

EXPOSE 3000 3443

ENV PORT=3000
ENV HTTPS_PORT=3443
ENV LISTEN_HOST="::"

CMD ["/app/z228_server"]
