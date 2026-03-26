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

const DEFAULT_CHANNEL = "general";
const CHANNEL_MAX_LEN = 32;

function normalizeChannelInput(raw) {
  let s = String(raw ?? "").trim().toLowerCase();
  if (!s) {
    s = DEFAULT_CHANNEL;
  }
  if (s.length > CHANNEL_MAX_LEN) {
    return { ok: false, reason: `Канал не длиннее ${CHANNEL_MAX_LEN} символов.` };
  }
  if (!/^[a-z0-9_-]+$/.test(s)) {
    return {
      ok: false,
      reason: "Недопустимый канал: только латиница, цифры, дефис и подчёркивание.",
    };
  }
  return { ok: true, channel: s };
}

/** ws → { nickname, channel } */
const clientsBySocket = new Map();
/** channel → Map(nickname → ws) */
const nickByChannel = new Map();
const wssList = [];

/** Каналы, которые когда-либо были в БД/памяти или сейчас с людьми (для общего списка). */
const knownChannelNames = new Set([DEFAULT_CHANNEL]);

function getNickMap(channel) {
  if (!nickByChannel.has(channel)) {
    nickByChannel.set(channel, new Map());
  }
  return nickByChannel.get(channel);
}

/** Если MongoDB недоступна — чат в RAM (до перезапуска), по каналам. */
let mongoReady = false;
const memoryChatByChannel = new Map();
const MEMORY_CHAT_LIMIT = 100;
let memoryChatSeq = 1;

function getMemoryChatArray(channel) {
  if (!memoryChatByChannel.has(channel)) {
    memoryChatByChannel.set(channel, []);
  }
  return memoryChatByChannel.get(channel);
}

function appendMemoryChat(channel, nickname, text, imageMime, imageData) {
  const arr = getMemoryChatArray(channel);
  const row = {
    id: String(memoryChatSeq++),
    nickname,
    text: text || "",
    imageMime: imageMime || null,
    imageData: imageData || null,
    createdAt: new Date(),
  };
  arr.push(row);
  while (arr.length > MEMORY_CHAT_LIMIT) {
    arr.shift();
  }
  return row;
}

function memoryChatHistoryPayload(channel) {
  return getMemoryChatArray(channel).map((d) => ({
    id: d.id,
    nickname: d.nickname,
    text: d.text,
    createdAt: d.createdAt.toISOString(),
    imageMime: d.imageMime || undefined,
    imageData: d.imageData || undefined,
  }));
}

function chatHistoryMongoFilter(channel) {
  if (channel === DEFAULT_CHANNEL) {
    return {
      $or: [
        { channel: DEFAULT_CHANNEL },
        { channel: { $exists: false } },
        { channel: null },
      ],
    };
  }
  return { channel };
}

async function hydrateKnownChannelsFromMongo() {
  if (!mongoReady || mongoose.connection.readyState !== 1) {
    return;
  }
  try {
    const arr = await ChatMessage.distinct("channel");
    for (const c of arr) {
      if (c) {
        knownChannelNames.add(String(c).trim().toLowerCase());
      }
    }
    const legacy = await ChatMessage.countDocuments({
      $or: [{ channel: { $exists: false } }, { channel: null }, { channel: "" }],
    });
    if (legacy > 0) {
      knownChannelNames.add(DEFAULT_CHANNEL);
    }
  } catch (error) {
    console.error("hydrateKnownChannelsFromMongo:", error);
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

function broadcastToChannel(channel, payload, exceptWs = null) {
  for (const wss of wssList) {
    for (const client of wss.clients) {
      if (client === exceptWs) {
        continue;
      }
      const c = clientsBySocket.get(client);
      if (c && c.channel === channel) {
        send(client, payload);
      }
    }
  }
}

function collectChannelNames() {
  const s = new Set(knownChannelNames);
  s.add(DEFAULT_CHANNEL);
  for (const [ch, map] of nickByChannel) {
    if (map.size > 0) {
      s.add(ch);
    }
  }
  for (const [ch, arr] of memoryChatByChannel) {
    if (arr.length > 0) {
      s.add(ch);
    }
  }
  return Array.from(s).sort((a, b) => a.localeCompare(b));
}

function buildChannelListPayload() {
  const names = collectChannelNames();
  const channels = names.map((name) => {
    const map = nickByChannel.get(name);
    const online = map ? map.size : 0;
    return { name, online };
  });
  return { type: "channel-list", channels };
}

function broadcastChannelListGlobally() {
  const payload = buildChannelListPayload();
  for (const wss of wssList) {
    for (const client of wss.clients) {
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
  const map = getNickMap(client.channel);
  map.delete(client.nickname);

  broadcastToChannel(client.channel, {
    type: "peer-left",
    nickname: client.nickname,
  });
  broadcastChannelListGlobally();
}

function attachWebSocketServer(server) {
  const wss = new WebSocketServer({ server });
  wssList.push(wss);

  wss.on("connection", (ws) => {
    send(ws, { type: "hello" });
    send(ws, buildChannelListPayload());

    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (error) {
        send(ws, { type: "error", message: "Неверный JSON." });
        return;
      }

      if (!message || typeof message !== "object" || Array.isArray(message)) {
        send(ws, { type: "error", message: "Неверный формат сообщения." });
        return;
      }

      const msgType = String(message.type ?? "").trim().toLowerCase();

      const clientShouldNotSend = new Set([
        "hello",
        "channel-list",
        "chat-history",
        "chat-message",
        "join-accepted",
        "join-rejected",
        "peer-joined",
        "peer-left",
        "signal-error",
        "error",
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
        const channelNorm = normalizeChannelInput(message.channel);

        if (!nickname) {
          send(ws, { type: "join-rejected", reason: "Нужен ник." });
          return;
        }

        if (!channelNorm.ok) {
          send(ws, { type: "join-rejected", reason: channelNorm.reason });
          return;
        }

        const channel = channelNorm.channel;

        if (clientsBySocket.has(ws)) {
          send(ws, { type: "join-rejected", reason: "Уже в комнате." });
          return;
        }

        const nickMap = getNickMap(channel);
        if (nickMap.has(nickname)) {
          send(ws, { type: "join-rejected", reason: "Этот ник уже занят в канале." });
          return;
        }

        clientsBySocket.set(ws, { nickname, channel });
        nickMap.set(nickname, ws);
        knownChannelNames.add(channel);

        const peers = Array.from(nickMap.keys()).filter((name) => name !== nickname);
        send(ws, { type: "join-accepted", nickname, channel, peers });

        broadcastToChannel(
          channel,
          {
            type: "peer-joined",
            nickname,
          },
          ws
        );
        broadcastChannelListGlobally();

        void (async () => {
          try {
            let messages;
            if (mongoReady && mongoose.connection.readyState === 1) {
              const filter = chatHistoryMongoFilter(channel);
              const docs = await ChatMessage.find(filter).sort({ createdAt: -1 }).limit(100).lean();
              messages = docs.reverse().map((d) => ({
                id: String(d._id),
                nickname: d.nickname,
                text: d.text || "",
                createdAt: d.createdAt.toISOString(),
                imageMime: d.imageMime || undefined,
                imageData: d.imageData || undefined,
              }));
            } else {
              messages = memoryChatHistoryPayload(channel);
            }
            send(ws, { type: "chat-history", messages });
          } catch (error) {
            console.error("chat-history:", error);
            send(ws, { type: "error", message: "Не удалось загрузить историю чата." });
          }
        })();
        return;
      }

      const sender = clientsBySocket.get(ws);
      if (!sender) {
        send(ws, { type: "error", message: "Сначала войдите в комнату." });
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
            if (mongoReady && mongoose.connection.readyState === 1) {
              knownChannelNames.add(sender.channel);
              const doc = await ChatMessage.create({
                channel: sender.channel,
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
              knownChannelNames.add(sender.channel);
              const row = appendMemoryChat(sender.channel, sender.nickname, text, outMime, outData);
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
            };
            if (outMime && outData) {
              payload.imageMime = outMime;
              payload.imageData = outData;
            }
            broadcastToChannel(sender.channel, payload);
          } catch (error) {
            console.error("chat save:", error);
            send(ws, { type: "error", message: "Не удалось сохранить сообщение." });
          }
        })();
        return;
      }

      if (msgType === "signal") {
        const target = (message.target || "").trim();
        const payload = message.payload;
        const roomMap = getNickMap(sender.channel);
        const targetSocket = roomMap.get(target);

        if (!targetSocket) {
          send(ws, {
            type: "signal-error",
            target,
            reason: "Участник не найден в этом канале.",
          });
          return;
        }

        const targetClient = clientsBySocket.get(targetSocket);
        if (!targetClient || targetClient.channel !== sender.channel) {
          send(ws, {
            type: "signal-error",
            target,
            reason: "Участник не найден в этом канале.",
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

      console.warn("Unknown WebSocket message type:", msgType, message);
      send(ws, {
        type: "error",
        message: `Неизвестный тип сообщения: ${msgType || "(пусто)"}`,
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
    await hydrateKnownChannelsFromMongo();
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
