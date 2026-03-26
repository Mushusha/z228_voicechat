FROM golang:1.23-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
COPY server ./server

RUN CGO_ENABLED=0 GOOS=linux go build -o /out/z228_server ./cmd/server

FROM alpine:3.20

WORKDIR /app

COPY --from=build /out/z228_server /app/z228_server
COPY server /app/server

EXPOSE 3000 3443

ENV PORT=3000
ENV HTTPS_PORT=3443
ENV LISTEN_HOST="::"

CMD ["/app/z228_server"]
