const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const selfsigned = require("selfsigned");
const { WebSocketServer } = require("ws");
const ChatMessage = require("./models/ChatMessage");

const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT === "0" ? 0 : Number(process.env.HTTPS_PORT) || 3443;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/zalupa228local";
/** Пароль для админ-панели (исключение участников). Переопределите в проде: ADMIN_PANEL_PASSWORD */
const ADMIN_PANEL_PASSWORD = process.env.ADMIN_PANEL_PASSWORD || "admin123";

function adminPanelSecretOk(message) {
  return String(message.secret || "") === ADMIN_PANEL_PASSWORD;
}

function listenOptions(port) {
  const host = process.env.LISTEN_HOST || "::";
  if (host === "::") {
    return { port, host: "::", ipv6Only: false };
  }
  return { port, host };
}

const app = express();
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html") || filePath.endsWith(".js")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
    },
  })
);

const clientsBySocket = new Map();
const socketsByNickname = new Map();
const wssList = [];

/** Если MongoDB недоступна — чат в RAM (до перезапуска). */
let mongoReady = false;
const memoryChat = [];
const MEMORY_CHAT_LIMIT = 100;
let memoryChatSeq = 1;

function appendMemoryChat(nickname, text, imageMime, imageData) {
  const row = {
    id: String(memoryChatSeq++),
    nickname,
    text: text || "",
    imageMime: imageMime || null,
    imageData: imageData || null,
    reactions: {},
    createdAt: new Date(),
  };
  memoryChat.push(row);
  while (memoryChat.length > MEMORY_CHAT_LIMIT) {
    memoryChat.shift();
  }
  return row;
}

function serializeReactionsForPayload(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v) && v.length) {
      out[k] = [...v];
    }
  }
  return out;
}

function memoryChatHistoryPayload() {
  return memoryChat.map((d) => ({
    id: d.id,
    nickname: d.nickname,
    text: d.text,
    createdAt: d.createdAt.toISOString(),
    imageMime: d.imageMime || undefined,
    imageData: d.imageData || undefined,
    reactions: serializeReactionsForPayload(d.reactions),
  }));
}

function normalizeReactionEmoji(raw) {
  const s = String(raw || "").trim();
  if (!s || s.length > 16) {
    return null;
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) {
    return null;
  }
  return s;
}

/** Объект reactions мутируется: переключить реакцию nickname на emoji. */
function toggleReactionOnStore(reactions, emoji, nickname) {
  const r = reactions;
  if (!r[emoji]) {
    r[emoji] = [];
  }
  const arr = r[emoji];
  const i = arr.indexOf(nickname);
  if (i >= 0) {
    arr.splice(i, 1);
    if (arr.length === 0) {
      delete r[emoji];
    }
  } else {
    arr.push(nickname);
  }
}

const CHAT_IMAGE_MAX_B64 = 2_500_000;
const CHAT_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function normalizeIncomingImage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  let mime = String(raw.mime || "").trim().toLowerCase();
  let data = String(raw.data || "").trim().replace(/\s/g, "");
  if (data.startsWith("data:")) {
    const m = data.match(/^data:([^;,]+);base64,(.+)$/i);
    if (m) {
      mime = String(m[1]).trim().toLowerCase();
      data = String(m[2]).trim();
    }
  }
  if (!mime || !data || !CHAT_IMAGE_MIMES.has(mime)) {
    return null;
  }
  if (data.length > CHAT_IMAGE_MAX_B64 || data.length < 32) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(data)) {
    return null;
  }
  return { mime, data };
}

/** Только 24-символьный hex — иначе in-memory id вроде "1" ошибочно проходил ObjectId.isValid и уходил в Mongo. */
function isMongoObjectIdString(s) {
  return typeof s === "string" && /^[a-fA-F0-9]{24}$/.test(s);
}

/** Нормализация type из клиента: пробелы, NFKC, невидимые символы, типографский дефис → ASCII. */
function normalizeWsMessageType(raw) {
  let s = String(raw ?? "")
    .trim()
    .toLowerCase();
  try {
    s = s.normalize("NFKC");
  } catch (_) {
    /* ignore */
  }
  return s
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g, "-");
}

/** Живое подключение к Mongo — надёжнее флага mongoReady после обрыва сессии. */
function mongooseLive() {
  return mongoose.connection.readyState === 1;
}

function getLocalIPv4Addresses() {
  const ips = new Set(["127.0.0.1"]);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const isIPv4 = net.family === "IPv4" || net.family === 4;
      if (isIPv4 && !net.internal) {
        ips.add(net.address);
      }
    }
  }
  return Array.from(ips);
}

async function createSelfSignedCredentials() {
  const altNames = [{ type: 2, value: "localhost" }];
  const seenIps = new Set();
  for (const ip of getLocalIPv4Addresses()) {
    if (!seenIps.has(ip)) {
      seenIps.add(ip);
      altNames.push({ type: 7, ip });
    }
  }
  for (const ip of (process.env.CERT_EXTRA_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (!seenIps.has(ip)) {
      seenIps.add(ip);
      altNames.push({ type: 7, ip });
    }
  }

  const attrs = [{ name: "commonName", value: "zalupa228local" }];
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    days: 365,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames,
      },
    ],
  });

  return {
    key: pems.private,
    cert: pems.cert,
  };
}

function send(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(payload, exceptWs = null) {
  for (const wss of wssList) {
    for (const client of wss.clients) {
      if (client === exceptWs) {
        continue;
      }
      send(client, payload);
    }
  }
}

function leave(ws) {
  const client = clientsBySocket.get(ws);
  if (!client) {
    return;
  }

  clientsBySocket.delete(ws);
  socketsByNickname.delete(client.nickname);

  broadcast({
    type: "peer-left",
    nickname: client.nickname,
  });
}

function attachWebSocketServer(server) {
  const wss = new WebSocketServer({ server });
  wssList.push(wss);

  wss.on("connection", (ws) => {
    send(ws, { type: "hello", adminPanel: true, chatMessageOps: true });

    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (error) {
        send(ws, { type: "error", message: "Invalid JSON payload." });
        return;
      }

      if (!message || typeof message !== "object" || Array.isArray(message)) {
        send(ws, { type: "error", message: "Invalid message shape." });
        return;
      }

      const msgType = normalizeWsMessageType(message.type);

      const clientShouldNotSend = new Set([
        "hello",
        "chat-history",
        "chat-message",
        "join-accepted",
        "join-rejected",
        "peer-joined",
        "peer-left",
        "signal-error",
        "error",
        "kicked",
        "admin-verify-ok",
        "admin-peers-result",
        "chat-message-updated",
        "chat-message-deleted",
        "chat-message-reactions",
      ]);
      if (clientShouldNotSend.has(msgType)) {
        return;
      }

      if (!msgType) {
        console.warn("WebSocket message without type:", message);
        return;
      }

      if (msgType === "join") {
        const nickname = (message.nickname || "").trim();

        if (!nickname) {
          send(ws, { type: "join-rejected", reason: "Nickname is required." });
          return;
        }

        if (clientsBySocket.has(ws)) {
          send(ws, { type: "join-rejected", reason: "Already joined." });
          return;
        }

        if (socketsByNickname.has(nickname)) {
          send(ws, { type: "join-rejected", reason: "Nickname already taken." });
          return;
        }

        clientsBySocket.set(ws, { nickname });
        socketsByNickname.set(nickname, ws);

        const peers = Array.from(socketsByNickname.keys()).filter((name) => name !== nickname);
        send(ws, { type: "join-accepted", nickname, peers });

        broadcast(
          {
            type: "peer-joined",
            nickname,
          },
          ws
        );

        void (async () => {
          try {
            let messages;
            if (mongooseLive()) {
              const docs = await ChatMessage.find().sort({ createdAt: -1 }).limit(100).lean();
              messages = docs.reverse().map((d) => ({
                id: String(d._id),
                nickname: d.nickname,
                text: d.text || "",
                createdAt: d.createdAt.toISOString(),
                imageMime: d.imageMime || undefined,
                imageData: d.imageData || undefined,
                reactions: serializeReactionsForPayload(d.reactions),
              }));
            } else {
              messages = memoryChatHistoryPayload();
            }
            send(ws, { type: "chat-history", messages });
          } catch (error) {
            console.error("chat-history:", error);
            send(ws, { type: "error", message: "Failed to load chat history." });
          }
        })();
        return;
      }

      const sender = clientsBySocket.get(ws);
      if (!sender) {
        send(ws, { type: "error", message: "Join before signaling." });
        return;
      }

      if (msgType === "chat") {
        const text = String(message.text || "").trim().slice(0, 500);
        const normalizedImg = normalizeIncomingImage(message.image);

        if (!text && !normalizedImg) {
          send(ws, { type: "error", message: "Пустое сообщение." });
          return;
        }
        if (message.image && !normalizedImg) {
          send(ws, {
            type: "error",
            message: "Некорректное изображение (тип или размер). Разрешены JPEG, PNG, GIF, WebP, до ~1.8 МБ.",
          });
          return;
        }

        void (async () => {
          try {
            let id;
            let outText = text;
            let outMime = normalizedImg ? normalizedImg.mime : null;
            let outData = normalizedImg ? normalizedImg.data : null;
            let createdAt;
            if (mongooseLive()) {
              const doc = await ChatMessage.create({
                nickname: sender.nickname,
                text: outText,
                imageMime: outMime || undefined,
                imageData: outData || undefined,
              });
              id = String(doc._id);
              outText = doc.text || "";
              outMime = doc.imageMime || null;
              outData = doc.imageData || null;
              createdAt = doc.createdAt.toISOString();
            } else {
              const row = appendMemoryChat(sender.nickname, text, outMime, outData);
              id = row.id;
              outText = row.text || "";
              outMime = row.imageMime;
              outData = row.imageData;
              createdAt = row.createdAt.toISOString();
            }
            const payload = {
              type: "chat-message",
              id,
              nickname: sender.nickname,
              text: outText,
              createdAt,
              reactions: {},
            };
            if (outMime && outData) {
              payload.imageMime = outMime;
              payload.imageData = outData;
            }
            broadcast(payload);
          } catch (error) {
            console.error("chat save:", error);
            send(ws, { type: "error", message: "Failed to save message." });
          }
        })();
        return;
      }

      if (msgType === "chat-edit") {
        const id = String(message.id || "").trim();
        const newText = String(message.text ?? "").trim().slice(0, 500);
        if (!id) {
          send(ws, { type: "error", message: "Нет id сообщения." });
          return;
        }
        void (async () => {
          try {
            if (mongooseLive() && isMongoObjectIdString(id)) {
              const doc = await ChatMessage.findOne({ _id: id, nickname: sender.nickname });
              if (!doc) {
                send(ws, { type: "error", message: "Сообщение не найдено." });
                return;
              }
              if (!newText && !doc.imageMime) {
                send(ws, { type: "error", message: "Нельзя оставить сообщение без текста и без фото." });
                return;
              }
              doc.text = newText;
              await doc.save();
              const idOut = String(doc._id);
              const payload = {
                type: "chat-message-updated",
                id: idOut,
                nickname: doc.nickname,
                text: doc.text || "",
                createdAt: doc.createdAt.toISOString(),
              };
              if (doc.imageMime && doc.imageData) {
                payload.imageMime = doc.imageMime;
                payload.imageData = doc.imageData;
              }
              payload.reactions = serializeReactionsForPayload(doc.reactions);
              broadcast(payload);
            } else if (isMongoObjectIdString(id)) {
              send(ws, {
                type: "error",
                message: "База данных недоступна. Перезапустите сервер (или docker compose up).",
              });
              return;
            } else {
              const row = memoryChat.find((r) => r.id === id && r.nickname === sender.nickname);
              if (!row) {
                send(ws, { type: "error", message: "Сообщение не найдено." });
                return;
              }
              if (!newText && !row.imageMime) {
                send(ws, { type: "error", message: "Нельзя оставить сообщение без текста и без фото." });
                return;
              }
              row.text = newText;
              const payload = {
                type: "chat-message-updated",
                id,
                nickname: row.nickname,
                text: row.text || "",
                createdAt: row.createdAt.toISOString(),
              };
              if (row.imageMime && row.imageData) {
                payload.imageMime = row.imageMime;
                payload.imageData = row.imageData;
              }
              payload.reactions = serializeReactionsForPayload(row.reactions);
              broadcast(payload);
            }
          } catch (error) {
            console.error("chat-edit:", error);
            send(ws, { type: "error", message: "Не удалось изменить сообщение." });
          }
        })();
        return;
      }

      if (msgType === "chat-react") {
        const id = String(message.id || "").trim();
        const emoji = normalizeReactionEmoji(message.emoji);
        if (!id || !emoji) {
          send(ws, { type: "error", message: "Нужны id сообщения и реакция." });
          return;
        }
        void (async () => {
          try {
            if (mongooseLive() && isMongoObjectIdString(id)) {
              const doc = await ChatMessage.findById(id);
              if (!doc) {
                send(ws, { type: "error", message: "Сообщение не найдено." });
                return;
              }
              const base = doc.reactions && typeof doc.reactions === "object" ? doc.reactions : {};
              const r0 = JSON.parse(JSON.stringify(base));
              toggleReactionOnStore(r0, emoji, sender.nickname);
              doc.reactions = r0;
              doc.markModified("reactions");
              await doc.save();
              broadcast({
                type: "chat-message-reactions",
                id: String(doc._id),
                reactions: serializeReactionsForPayload(r0),
              });
            } else if (isMongoObjectIdString(id)) {
              send(ws, {
                type: "error",
                message: "База данных недоступна. Перезапустите сервер (или docker compose up).",
              });
              return;
            } else {
              const row = memoryChat.find((r) => r.id === id);
              if (!row) {
                send(ws, { type: "error", message: "Сообщение не найдено." });
                return;
              }
              if (!row.reactions || typeof row.reactions !== "object") {
                row.reactions = {};
              }
              toggleReactionOnStore(row.reactions, emoji, sender.nickname);
              broadcast({
                type: "chat-message-reactions",
                id,
                reactions: serializeReactionsForPayload(row.reactions),
              });
            }
          } catch (error) {
            console.error("chat-react:", error);
            send(ws, { type: "error", message: "Не удалось поставить реакцию." });
          }
        })();
        return;
      }

      if (msgType === "chat-delete") {
        const id = String(message.id || "").trim();
        if (!id) {
          send(ws, { type: "error", message: "Нет id сообщения." });
          return;
        }
        void (async () => {
          try {
            if (mongooseLive() && isMongoObjectIdString(id)) {
              const res = await ChatMessage.deleteOne({ _id: id, nickname: sender.nickname });
              if (res.deletedCount === 0) {
                send(ws, { type: "error", message: "Сообщение не найдено." });
                return;
              }
              broadcast({ type: "chat-message-deleted", id: String(id) });
            } else if (isMongoObjectIdString(id)) {
              send(ws, {
                type: "error",
                message: "База данных недоступна. Перезапустите сервер (или docker compose up).",
              });
              return;
            } else {
              const idx = memoryChat.findIndex((r) => r.id === id && r.nickname === sender.nickname);
              if (idx === -1) {
                send(ws, { type: "error", message: "Сообщение не найдено." });
                return;
              }
              memoryChat.splice(idx, 1);
              broadcast({ type: "chat-message-deleted", id });
            }
          } catch (error) {
            console.error("chat-delete:", error);
            send(ws, { type: "error", message: "Не удалось удалить сообщение." });
          }
        })();
        return;
      }

      if (msgType === "signal") {
        const target = (message.target || "").trim();
        const payload = message.payload;
        const targetSocket = socketsByNickname.get(target);

        if (!targetSocket) {
          send(ws, {
            type: "signal-error",
            target,
            reason: "Target not found.",
          });
          return;
        }

        send(targetSocket, {
          type: "signal",
          from: sender.nickname,
          payload,
        });
        return;
      }

      if (msgType === "admin-verify") {
        if (!adminPanelSecretOk(message)) {
          send(ws, { type: "error", message: "Неверный пароль." });
          return;
        }
        send(ws, { type: "admin-verify-ok" });
        return;
      }

      if (msgType === "admin-peers") {
        if (!adminPanelSecretOk(message)) {
          send(ws, { type: "error", message: "Неверный пароль админ-панели." });
          return;
        }
        const roster = Array.from(socketsByNickname.keys()).sort((a, b) => a.localeCompare(b, "ru"));
        send(ws, { type: "admin-peers-result", peers: roster });
        return;
      }

      if (msgType === "admin-kick") {
        if (!adminPanelSecretOk(message)) {
          send(ws, { type: "error", message: "Неверный пароль админ-панели." });
          return;
        }
        const targetNick = String(message.target || "").trim();
        if (!targetNick) {
          send(ws, { type: "error", message: "Укажите ник участника." });
          return;
        }
        const targetWs = socketsByNickname.get(targetNick);
        if (!targetWs) {
          send(ws, { type: "error", message: "Участник не в комнате." });
          return;
        }
        send(targetWs, {
          type: "kicked",
          reason: `Вас исключили из комнаты (оператор: ${sender.nickname}).`,
        });
        const kicked = clientsBySocket.get(targetWs);
        if (kicked) {
          clientsBySocket.delete(targetWs);
          socketsByNickname.delete(kicked.nickname);
          broadcast({
            type: "peer-left",
            nickname: kicked.nickname,
          });
        }
        try {
          targetWs.close(4000, "kicked");
        } catch (_) {}
        return;
      }

      console.warn("Unknown WebSocket message type:", msgType, message);
      send(ws, {
        type: "error",
        message: `Unknown message type: ${msgType || "(empty)"}`,
      });
    });

    ws.on("close", () => {
      leave(ws);
    });

    ws.on("error", () => {
      leave(ws);
    });
  });
}

async function start() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
    });
    mongoReady = true;
    console.log("MongoDB connected — chat persists in the database");
  } catch (error) {
    mongoReady = false;
    console.warn("MongoDB unavailable — chat uses in-memory store (cleared on restart).");
    console.warn("  Reason:", error.message || error);
    console.warn("  Optional: docker compose up, or install MongoDB; MONGODB_URI=", MONGODB_URI);
  }

  const httpServer = http.createServer(app);
  attachWebSocketServer(httpServer);

  httpServer.on("error", (err) => {
    console.error("HTTP server error:", err);
  });
  httpServer.listen(listenOptions(PORT), () => {
    const hostHint = process.env.LISTEN_HOST || ":: (all interfaces, IPv4+IPv6)";
    console.log(`HTTP: http://127.0.0.1:${PORT} — listening ${hostHint}`);
    console.log(
      "WebSocket: join, chat, chat-edit, chat-delete, chat-react, signal, admin-verify, admin-peers, admin-kick"
    );
  });

  if (HTTPS_PORT > 0) {
    const credentials = await createSelfSignedCredentials();
    const httpsServer = https.createServer(credentials, app);
    attachWebSocketServer(httpsServer);

    httpsServer.on("error", (err) => {
      console.error("HTTPS server error:", err);
    });
    httpsServer.listen(listenOptions(HTTPS_PORT), () => {
      console.log(`HTTPS: https://127.0.0.1:${HTTPS_PORT} — same port from LAN / Docker`);
      console.log(
        "Open https://<this-pc-ip>:" + HTTPS_PORT + " on other devices; accept the self-signed cert once."
      );
    });
  }
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
