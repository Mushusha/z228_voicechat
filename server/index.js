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

/** ws → { nickname, channel } — один канал на чат и голос */
const clientsBySocket = new Map();
/** канал → Map(nickname → ws) */
const nickByChannel = new Map();
const wssList = [];

/** Каналы из БД / памяти / активные. */
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
    reactions: {},
    createdAt: new Date(),
  };
  arr.push(row);
  while (arr.length > MEMORY_CHAT_LIMIT) {
    arr.shift();
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

function memoryChatHistoryPayload(channel) {
  return getMemoryChatArray(channel).map((d) => ({
    id: d.id,
    nickname: d.nickname,
    text: d.text,
    createdAt: d.createdAt.toISOString(),
    imageMime: d.imageMime || undefined,
    imageData: d.imageData || undefined,
    reactions: serializeReactionsForPayload(d.reactions),
  }));
}

function mongooseLive() {
  return mongoReady && mongoose.connection.readyState === 1;
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

function toggleReactionOnStore(reactions, emoji, nickname) {
  const r = reactions;
  if (!r[emoji]) {
    r[emoji] = [nickname];
    return;
  }
  const arr = r[emoji];
  const idx = arr.indexOf(nickname);
  if (idx >= 0) {
    arr.splice(idx, 1);
    if (arr.length === 0) {
      delete r[emoji];
    }
  } else {
    arr.push(nickname);
  }
}

function findMemoryMessageRow(channel, id) {
  const sid = String(id || "");
  if (!sid) {
    return null;
  }
  const arr = getMemoryChatArray(channel);
  return arr.find((row) => String(row.id) === sid) || null;
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
    const m = nickByChannel.get(name);
    const members = m ? Array.from(m.keys()).sort((a, b) => a.localeCompare(b)) : [];
    return { name, online: members.length, members };
  });
  return {
    type: "channel-list",
    channels,
    textChannels: channels,
    voiceChannels: channels,
  };
}

function broadcastChannelListGlobally() {
  const payload = buildChannelListPayload();
  for (const wss of wssList) {
    for (const client of wss.clients) {
      send(client, payload);
    }
  }
}

function broadcastToAllClients(payload) {
  for (const wss of wssList) {
    for (const client of wss.clients) {
      send(client, payload);
    }
  }
}

function sendChatHistoryToSocket(ws, textChannel) {
  void (async () => {
    try {
      let messages;
      if (mongoReady && mongoose.connection.readyState === 1) {
        const filter = chatHistoryMongoFilter(textChannel);
        const docs = await ChatMessage.find(filter).sort({ createdAt: -1 }).limit(100).lean();
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
        messages = memoryChatHistoryPayload(textChannel);
      }
      send(ws, { type: "chat-history", messages });
    } catch (error) {
      console.error("chat-history:", error);
      send(ws, { type: "error", message: "Не удалось загрузить историю чата." });
    }
  })();
}

/**
 * Смена канала (чат + голос) без повторного join.
 * options.skipChannelListBroadcast — для пакетных admin-операций.
 */
function performChannelSwitch(ws, sender, newChannel, options = {}) {
  const nickname = sender.nickname;
  const oldCh = sender.channel;

  if (oldCh === newChannel) {
    const peers = Array.from(getNickMap(newChannel).keys()).filter((name) => name !== nickname);
    send(ws, {
      type: "channels-switched",
      channel: newChannel,
      textChannel: newChannel,
      voiceChannel: newChannel,
      peers,
      channelChanged: false,
      textChannelChanged: false,
      voiceChannelChanged: false,
    });
    return { ok: true };
  }

  const nm = getNickMap(newChannel);
  if (nm.has(nickname) && nm.get(nickname) !== ws) {
    return { ok: false, reason: "Этот ник уже занят в целевом канале." };
  }

  getNickMap(oldCh).delete(nickname);
  broadcastToChannel(oldCh, {
    type: "peer-left",
    nickname,
  });

  sender.channel = newChannel;
  getNickMap(newChannel).set(nickname, ws);
  broadcastToChannel(
    newChannel,
    {
      type: "peer-joined",
      nickname,
    },
    ws
  );

  knownChannelNames.add(newChannel);
  if (!options.skipChannelListBroadcast) {
    broadcastChannelListGlobally();
  }

  const peers = Array.from(getNickMap(newChannel).keys()).filter((name) => name !== nickname);
  send(ws, {
    type: "channels-switched",
    channel: newChannel,
    textChannel: newChannel,
    voiceChannel: newChannel,
    peers,
    channelChanged: true,
    textChannelChanged: true,
    voiceChannelChanged: true,
  });

  sendChatHistoryToSocket(ws, newChannel);
  return { ok: true };
}

function mergeMemoryChatRename(oldName, newName) {
  const oldArr = memoryChatByChannel.get(oldName);
  if (!oldArr || oldArr.length === 0) {
    memoryChatByChannel.delete(oldName);
    return;
  }
  const merged = getMemoryChatArray(newName).concat(oldArr);
  merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  while (merged.length > MEMORY_CHAT_LIMIT) {
    merged.shift();
  }
  memoryChatByChannel.set(newName, merged);
  memoryChatByChannel.delete(oldName);
}

function leave(ws) {
  const client = clientsBySocket.get(ws);
  if (!client) {
    return;
  }

  clientsBySocket.delete(ws);
  getNickMap(client.channel).delete(client.nickname);

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
    send(ws, { type: "hello", adminPanel: true, chatMessageOps: true });
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
        "chat-message-updated",
        "chat-message-deleted",
        "chat-message-reactions",
        "join-accepted",
        "join-rejected",
        "peer-joined",
        "peer-left",
        "signal-error",
        "error",
        "kicked",
        "admin-verify-ok",
        "admin-peers-result",
        "channels-switched",
        "channel-removed",
        "channel-renamed",
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
        const rawCh =
          message.channel !== undefined && message.channel !== null
            ? message.channel
            : message.textChannel !== undefined && message.textChannel !== null
              ? message.textChannel
              : message.voiceChannel;
        const chNorm = normalizeChannelInput(rawCh);

        if (!nickname) {
          send(ws, { type: "join-rejected", reason: "Нужен ник." });
          return;
        }

        if (!chNorm.ok) {
          send(ws, { type: "join-rejected", reason: chNorm.reason });
          return;
        }

        const channel = chNorm.channel;

        if (clientsBySocket.has(ws)) {
          send(ws, { type: "join-rejected", reason: "Уже в комнате." });
          return;
        }

        const room = getNickMap(channel);
        if (room.has(nickname)) {
          send(ws, { type: "join-rejected", reason: "Этот ник уже занят в этом канале." });
          return;
        }

        clientsBySocket.set(ws, { nickname, channel });
        room.set(nickname, ws);
        knownChannelNames.add(channel);

        const peers = Array.from(room.keys()).filter((name) => name !== nickname);
        send(ws, {
          type: "join-accepted",
          nickname,
          channel,
          textChannel: channel,
          voiceChannel: channel,
          peers,
        });

        broadcastToChannel(
          channel,
          {
            type: "peer-joined",
            nickname,
          },
          ws
        );
        broadcastChannelListGlobally();

        sendChatHistoryToSocket(ws, channel);
        return;
      }

      const sender = clientsBySocket.get(ws);
      if (!sender) {
        send(ws, { type: "error", message: "Сначала войдите в комнату." });
        return;
      }

      if (msgType === "switch-channels") {
        const rawCh =
          message.channel !== undefined && message.channel !== null
            ? message.channel
            : message.textChannel !== undefined && message.textChannel !== null
              ? message.textChannel
              : message.voiceChannel;
        const chNorm = normalizeChannelInput(rawCh);
        if (!chNorm.ok) {
          send(ws, { type: "error", message: chNorm.reason });
          return;
        }
        const result = performChannelSwitch(ws, sender, chNorm.channel);
        if (!result.ok) {
          send(ws, { type: "error", message: result.reason });
        }
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
              knownChannelNames.add(sender.channel);
              const doc = await ChatMessage.create({
                channel: sender.channel,
                nickname: sender.nickname,
                text: outText,
                imageMime: outMime || undefined,
                imageData: outData || undefined,
                reactions: {},
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
              reactions: {},
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

      if (msgType === "chat-edit") {
        const idRaw = message.id != null ? String(message.id).trim() : "";
        const newText = String(message.text || "").trim().slice(0, 500);
        if (!idRaw || !newText) {
          send(ws, { type: "error", message: "Укажите сообщение и новый текст." });
          return;
        }
        void (async () => {
          try {
            if (mongooseLive()) {
              if (!mongoose.isValidObjectId(idRaw)) {
                send(ws, { type: "error", message: "Некорректный id сообщения." });
                return;
              }
              const doc = await ChatMessage.findOne({
                _id: idRaw,
                channel: sender.channel,
                nickname: sender.nickname,
              }).lean();
              if (!doc) {
                send(ws, { type: "error", message: "Сообщение не найдено или чужое." });
                return;
              }
              await ChatMessage.updateOne(
                { _id: idRaw, channel: sender.channel, nickname: sender.nickname },
                { $set: { text: newText } }
              );
            } else {
              const row = findMemoryMessageRow(sender.channel, idRaw);
              if (!row || row.nickname !== sender.nickname) {
                send(ws, { type: "error", message: "Сообщение не найдено или чужое." });
                return;
              }
              row.text = newText;
            }
            broadcastToChannel(sender.channel, {
              type: "chat-message-updated",
              id: idRaw,
              text: newText,
            });
          } catch (error) {
            console.error("chat-edit:", error);
            send(ws, { type: "error", message: "Не удалось изменить сообщение." });
          }
        })();
        return;
      }

      if (msgType === "chat-delete") {
        const idRaw = message.id != null ? String(message.id).trim() : "";
        if (!idRaw) {
          send(ws, { type: "error", message: "Укажите id сообщения." });
          return;
        }
        void (async () => {
          try {
            if (mongooseLive()) {
              if (!mongoose.isValidObjectId(idRaw)) {
                send(ws, { type: "error", message: "Некорректный id сообщения." });
                return;
              }
              const res = await ChatMessage.deleteOne({
                _id: idRaw,
                channel: sender.channel,
                nickname: sender.nickname,
              });
              if (res.deletedCount === 0) {
                send(ws, { type: "error", message: "Сообщение не найдено или чужое." });
                return;
              }
            } else {
              const arr = getMemoryChatArray(sender.channel);
              const idx = arr.findIndex((row) => String(row.id) === idRaw && row.nickname === sender.nickname);
              if (idx === -1) {
                send(ws, { type: "error", message: "Сообщение не найдено или чужое." });
                return;
              }
              arr.splice(idx, 1);
            }
            broadcastToChannel(sender.channel, {
              type: "chat-message-deleted",
              id: idRaw,
            });
          } catch (error) {
            console.error("chat-delete:", error);
            send(ws, { type: "error", message: "Не удалось удалить сообщение." });
          }
        })();
        return;
      }

      if (msgType === "chat-react") {
        const idRaw = message.id != null ? String(message.id).trim() : "";
        const emoji = normalizeReactionEmoji(message.emoji);
        if (!idRaw || !emoji) {
          send(ws, { type: "error", message: "Некорректная реакция." });
          return;
        }
        void (async () => {
          try {
            if (mongooseLive()) {
              if (!mongoose.isValidObjectId(idRaw)) {
                send(ws, { type: "error", message: "Некорректный id сообщения." });
                return;
              }
              const doc = await ChatMessage.findOne({
                _id: idRaw,
                channel: sender.channel,
              }).lean();
              if (!doc) {
                send(ws, { type: "error", message: "Сообщение не найдено." });
                return;
              }
              const reactRaw = doc.reactions && typeof doc.reactions === "object" ? doc.reactions : {};
              const next = { ...serializeReactionsForPayload(reactRaw) };
              toggleReactionOnStore(next, emoji, sender.nickname);
              await ChatMessage.updateOne({ _id: idRaw, channel: sender.channel }, { $set: { reactions: next } });
              broadcastToChannel(sender.channel, {
                type: "chat-message-reactions",
                id: idRaw,
                reactions: serializeReactionsForPayload(next),
              });
            } else {
              const row = findMemoryMessageRow(sender.channel, idRaw);
              if (!row) {
                send(ws, { type: "error", message: "Сообщение не найдено." });
                return;
              }
              if (!row.reactions || typeof row.reactions !== "object") {
                row.reactions = {};
              }
              toggleReactionOnStore(row.reactions, emoji, sender.nickname);
              broadcastToChannel(sender.channel, {
                type: "chat-message-reactions",
                id: idRaw,
                reactions: serializeReactionsForPayload(row.reactions),
              });
            }
          } catch (error) {
            console.error("chat-react:", error);
            send(ws, { type: "error", message: "Не удалось обновить реакцию." });
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
        const roster = Array.from(clientsBySocket.values())
          .map((c) => ({
            nickname: c.nickname,
            channel: c.channel,
            textChannel: c.channel,
            voiceChannel: c.channel,
          }))
          .sort((a, b) => a.nickname.localeCompare(b.nickname, "ru"));
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
        let targetWs = null;
        for (const [sock, c] of clientsBySocket) {
          if (c.nickname === targetNick) {
            targetWs = sock;
            break;
          }
        }
        if (!targetWs) {
          send(ws, { type: "error", message: "Участник не в комнате." });
          return;
        }
        send(targetWs, {
          type: "kicked",
          reason: `Вас исключили из комнаты (оператор: ${sender.nickname}).`,
        });
        leave(targetWs);
        try {
          targetWs.close(4000, "kicked");
        } catch (_) {}
        return;
      }

      if (msgType === "admin-channel-remove") {
        if (!adminPanelSecretOk(message)) {
          send(ws, { type: "error", message: "Неверный пароль админ-панели." });
          return;
        }
        const nameNorm = normalizeChannelInput(message.name ?? message.channel);
        if (!nameNorm.ok) {
          send(ws, { type: "error", message: nameNorm.reason });
          return;
        }
        const chName = nameNorm.channel;
        if (chName === DEFAULT_CHANNEL) {
          send(ws, { type: "error", message: "Канал general нельзя удалить." });
          return;
        }
        const toMove = [];
        for (const [sock, c] of clientsBySocket) {
          if (c.channel === chName) {
            toMove.push(sock);
          }
        }
        for (const sock of toMove) {
          const c = clientsBySocket.get(sock);
          if (!c) continue;
          performChannelSwitch(sock, c, DEFAULT_CHANNEL, { skipChannelListBroadcast: true });
        }
        knownChannelNames.delete(chName);
        nickByChannel.delete(chName);
        broadcastToAllClients({
          type: "channel-removed",
          name: chName,
        });
        broadcastChannelListGlobally();
        return;
      }

      if (msgType === "admin-channel-rename") {
        if (!adminPanelSecretOk(message)) {
          send(ws, { type: "error", message: "Неверный пароль админ-панели." });
          return;
        }
        const oldNorm = normalizeChannelInput(message.oldName ?? message.from ?? message.oldChannel);
        const newNorm = normalizeChannelInput(message.newName ?? message.to ?? message.newChannel);
        if (!oldNorm.ok) {
          send(ws, { type: "error", message: oldNorm.reason });
          return;
        }
        if (!newNorm.ok) {
          send(ws, { type: "error", message: newNorm.reason });
          return;
        }
        const oldName = oldNorm.channel;
        const newName = newNorm.channel;
        if (oldName === DEFAULT_CHANNEL) {
          send(ws, { type: "error", message: "Канал general нельзя переименовать." });
          return;
        }
        if (oldName === newName) {
          send(ws, { type: "error", message: "Имя совпадает с текущим." });
          return;
        }
        const dest = getNickMap(newName);
        const src = getNickMap(oldName);
        for (const [nick, srcWs] of src) {
          const existing = dest.get(nick);
          if (existing && existing !== srcWs) {
            send(ws, {
              type: "error",
              message: `Ник «${nick}» уже есть в канале «${newName}» — переименование отменено.`,
            });
            return;
          }
        }
        void (async () => {
          try {
            if (mongoose.connection.readyState === 1) {
              await ChatMessage.updateMany({ channel: oldName }, { $set: { channel: newName } });
            }
            mergeMemoryChatRename(oldName, newName);
            const socks = [];
            for (const [sock, c] of clientsBySocket) {
              if (c.channel === oldName) {
                socks.push(sock);
              }
            }
            for (const sock of socks) {
              const c = clientsBySocket.get(sock);
              if (!c) continue;
              performChannelSwitch(sock, c, newName, { skipChannelListBroadcast: true });
            }
            nickByChannel.delete(oldName);
            knownChannelNames.delete(oldName);
            knownChannelNames.add(newName);
            broadcastToAllClients({
              type: "channel-renamed",
              oldName,
              newName,
            });
            broadcastChannelListGlobally();
          } catch (error) {
            console.error("admin-channel-rename:", error);
            send(ws, { type: "error", message: "Не удалось переименовать канал." });
          }
        })();
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
    console.log(
      "WebSocket: join / switch-channels / chat / signal / admin-verify / admin-peers / admin-kick / admin-channel-remove / admin-channel-rename"
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
