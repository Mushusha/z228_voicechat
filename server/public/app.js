const NICK_COOKIE = "zalupa228_nick";
const NICK_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
const SS_JOINED = "zalupa_vc_joined";
const SS_NICK = "zalupa_vc_nick";
const LS_THEME = "zalupa_theme";
const LS_PEER_AUDIO = "zalupa228_peer_audio";
const LS_MIC_ENABLED = "zalupa228_mic_on";

/** Быстрые реакции (пикер «＋»); остальные эмодзи появляются, если уже есть на сервере. */
const QUICK_REACTION_EMOJIS = [
  "👍",
  "❤️",
  "😂",
  "🤣",
  "😮",
  "😢",
  "😍",
  "🔥",
  "🎉",
  "👏",
  "🙏",
  "🙌",
  "💯",
  "👀",
  "🤔",
  "💀",
  "🤝",
  "⭐",
  "✨",
];

function clearRejoinHint() {
  sessionStorage.removeItem(SS_JOINED);
  sessionStorage.removeItem(SS_NICK);
}

function leaveRoom() {
  clearRejoinHint();
  forceDisconnectClient();
  joinBtn.disabled = false;
  nicknameInput.disabled = false;
  if (chatLog) {
    chatLog.innerHTML = "";
  }
  setStatus("Вы вышли из комнаты.");
}

/** Закрытие вкладки / уход со страницы: сразу закрыть сигнальный сокет, чтобы сервер разослал peer-left. */
function closeSignalingOnPageExit() {
  const s = socket;
  if (!s) {
    return;
  }
  if (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING) {
    try {
      s.close(1000, "tab_closed");
    } catch (_) {}
  }
}

window.addEventListener("pagehide", closeSignalingOnPageExit);
window.addEventListener("beforeunload", closeSignalingOnPageExit);

/** Сброс незавершённого входа: «висящий» WebSocket в CONNECTING блокировал повторный join(). */
function forceDisconnectClient() {
  joinedRoom = false;
  if (socket) {
    const s = socket;
    socket = null;
    s.onopen = null;
    s.onerror = null;
    s.onmessage = null;
    s.onclose = null;
    try {
      s.close();
    } catch (_) {}
  }
  rtcChain = Promise.resolve();
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  for (const peerNickname of Array.from(peers.keys())) {
    removePeer(peerNickname);
  }
  if (micBtn) {
    micBtn.disabled = true;
  }
  setChatEnabled(false);
  if (leaveBtn) {
    leaveBtn.disabled = true;
  }
}

function setCookie(name, value, maxAgeSec) {
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)};path=/;max-age=${maxAgeSec};SameSite=Lax`;
}

function getCookie(name) {
  const pref = `${encodeURIComponent(name)}=`;
  const parts = document.cookie.split("; ");
  for (const p of parts) {
    if (p.startsWith(pref)) {
      return decodeURIComponent(p.slice(pref.length));
    }
  }
  return "";
}

(function initThemeFromStorage() {
  const saved = localStorage.getItem(LS_THEME);
  document.documentElement.setAttribute("data-theme", saved === "light" ? "light" : "dark");
})();

const nicknameInput = document.getElementById("nickname");
const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const micBtn = document.getElementById("micBtn");
const micBtnIcon = document.getElementById("micBtnIcon");
const chatMenuBtn = document.getElementById("chatMenuBtn");
const chatDropdown = document.getElementById("chatDropdown");
const menuThemeBtn = document.getElementById("menuThemeBtn");
const menuAdminBtn = document.getElementById("menuAdminBtn");
const adminModal = document.getElementById("adminModal");
const adminModalClose = document.getElementById("adminModalClose");
const adminParticipantsList = document.getElementById("adminParticipantsList");
const adminAuthSection = document.getElementById("adminAuthSection");
const adminPanelBody = document.getElementById("adminPanelBody");
const adminPasswordInput = document.getElementById("adminPasswordInput");
const adminAuthSubmit = document.getElementById("adminAuthSubmit");
const adminAuthError = document.getElementById("adminAuthError");
const adminJoinHint = document.getElementById("adminJoinHint");
const adminLogoutBtn = document.getElementById("adminLogoutBtn");
const statusEl = document.getElementById("status");
const participantsEl = document.getElementById("participants");
const chatLog = document.getElementById("chatLog");
const chatMainEl = document.querySelector(".chat-main");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatImageInput = document.getElementById("chatImageInput");
const chatImageBtn = document.getElementById("chatImageBtn");

const peers = new Map();

const MIC_ICON_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;

const MIC_ICON_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const remoteAudioByPeer = new Map();
const hearByPeer = new Map();
const pendingIceByPeer = new Map();
const disconnectTimers = new Map();
const volumePercentByPeer = new Map();
const peerAudioGraphs = new Map();

let audioContext = null;

function getOrCreateAudioContext() {
  if (!audioContext) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioContext = AC ? new AC() : null;
  }
  return audioContext;
}

async function resumeAudioContextIfNeeded() {
  const ctx = getOrCreateAudioContext();
  if (ctx && ctx.state === "suspended") {
    await ctx.resume();
  }
}

function pushPendingIce(peerNickname, candidateInit) {
  if (!pendingIceByPeer.has(peerNickname)) {
    pendingIceByPeer.set(peerNickname, []);
  }
  pendingIceByPeer.get(peerNickname).push(candidateInit);
}

async function flushPendingIce(peerNickname) {
  const pc = peers.get(peerNickname);
  if (!pc || !pc.remoteDescription) {
    return;
  }
  const queued = pendingIceByPeer.get(peerNickname);
  if (!queued || queued.length === 0) {
    return;
  }
  pendingIceByPeer.set(peerNickname, []);
  for (const init of queued) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(init));
    } catch (error) {
      console.error("flush ICE failed", peerNickname, error);
    }
  }
}

let myNickname = null;
let socket = null;
let localStream = null;
let micEnabled = true;
let joinedRoom = false;
/** null до первого hello; false — сервер без chat-edit/chat-delete (старый процесс/образ). */
let serverChatMessageOps = null;
let rtcChain = Promise.resolve();
/** Если не null, socket.onclose не затирает статус сообщением «Отключено» (исключение из комнаты). */
let pendingKickedDisconnectStatus = null;

let cachedAdminSecret = null;
let adminServerPeers = [];
let pendingAdminSecretAttempt = null;
let awaitingAdminVerifyResponse = false;

function enqueueRtc(fn) {
  rtcChain = rtcChain.then(fn).catch((e) => console.error("WebRTC queue:", e));
  return rtcChain;
}

function sdpPayload(desc) {
  if (!desc) {
    return null;
  }
  return { type: desc.type, sdp: desc.sdp };
}

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

function getAudioConstraints() {
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  };
}

function seedPeerAudioFromStorage(peerNickname) {
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(LS_PEER_AUDIO) || "{}");
  } catch (_) {
    store = {};
  }
  const row = store[peerNickname];
  if (row && typeof row.v === "number" && row.v >= 0 && row.v <= 200) {
    volumePercentByPeer.set(peerNickname, row.v);
  } else {
    volumePercentByPeer.set(peerNickname, 100);
  }
  if (row && row.m === true) {
    hearByPeer.set(peerNickname, false);
  } else {
    hearByPeer.set(peerNickname, true);
  }
}

function persistPeerAudioSettings() {
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(LS_PEER_AUDIO) || "{}");
  } catch (_) {
    store = {};
  }
  for (const peerNickname of peers.keys()) {
    store[peerNickname] = {
      v: volumePercentByPeer.get(peerNickname) ?? 100,
      m: hearByPeer.get(peerNickname) === false,
    };
  }
  try {
    localStorage.setItem(LS_PEER_AUDIO, JSON.stringify(store));
  } catch (e) {
    console.warn("peer audio prefs", e);
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setChatEnabled(enabled) {
  if (!chatInput || !chatSendBtn) {
    return;
  }
  chatInput.disabled = !enabled;
  chatSendBtn.disabled = !enabled;
  if (chatImageBtn) {
    chatImageBtn.disabled = !enabled;
  }
}

function formatChatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseDataUrlImageParts(dataUrl) {
  const u = String(dataUrl).trim();
  const idx = u.indexOf(";base64,");
  if (idx === -1) {
    return null;
  }
  const mime = u.slice(5, idx).split(";")[0].trim().toLowerCase();
  const data = u.slice(idx + 8).replace(/\s/g, "");
  if (!mime.startsWith("image/") || data.length < 32) {
    return null;
  }
  return { mime, data };
}

async function prepareImageForChat(file) {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const maxW = 1024;
      const maxH = 1024;
      let w = bitmap.width;
      let h = bitmap.height;
      const scale = Math.min(1, maxW / w, maxH / h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob) {
        throw new Error("toBlob");
      }
      const buf = await blob.arrayBuffer();
      return { mime: "image/jpeg", data: uint8ToBase64(new Uint8Array(buf)) };
    } finally {
      bitmap.close();
    }
  } catch (_) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const parsed = parseDataUrlImageParts(String(dataUrl));
    if (parsed) {
      return parsed;
    }
    throw new Error("read fail");
  }
}

function chatLineElById(id) {
  if (!chatLog || id == null || id === "") {
    return null;
  }
  const s = String(id);
  const sel =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? `[data-message-id="${CSS.escape(s)}"]`
      : `[data-message-id="${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
  return chatLog.querySelector(sel);
}

function closeAllChatMessageMenus() {
  document.querySelectorAll(".chat-msg-dropdown").forEach((el) => {
    el.hidden = true;
  });
  document.querySelectorAll(".btn-msg-ellipsis").forEach((btn) => {
    btn.setAttribute("aria-expanded", "false");
  });
}

function closeAllReactionPickers() {
  document.querySelectorAll(".chat-reaction-picker-inline").forEach((el) => el.remove());
}

function sendChatReaction(messageId, emoji) {
  if (!joinedRoom || !socket || socket.readyState !== WebSocket.OPEN || !messageId) {
    return;
  }
  try {
    socket.send(JSON.stringify({ type: "chat-react", id: String(messageId), emoji }));
  } catch (e) {
    console.error(e);
    setStatus("Не удалось отправить реакцию.");
  }
}

function renderReactionsStrip(line, messageId, reactions) {
  if (messageId == null || messageId === "") {
    return;
  }
  let bar = line.querySelector(".chat-reactions");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "chat-reactions";
    line.appendChild(bar);
  }
  bar.replaceChildren();
  const counts = reactions && typeof reactions === "object" ? reactions : {};
  const seen = new Set(QUICK_REACTION_EMOJIS);
  const activeQuick = QUICK_REACTION_EMOJIS.filter((e) => Array.isArray(counts[e]) && counts[e].length);
  const extras = Object.keys(counts).filter(
    (e) => !seen.has(e) && Array.isArray(counts[e]) && counts[e].length
  );
  const activeList = [...activeQuick, ...extras.sort()];
  bar.classList.toggle("chat-reactions--has-pills", activeList.length > 0);

  function makeReactionPill(emo) {
    const nicks = Array.isArray(counts[emo]) ? counts[emo] : [];
    if (!emo || !nicks.length) {
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-reaction-btn";
    if (myNickname && nicks.includes(myNickname)) {
      btn.classList.add("chat-reaction-btn-active");
    }
    const spanE = document.createElement("span");
    spanE.className = "chat-reaction-emoji";
    spanE.textContent = emo;
    btn.appendChild(spanE);
    const c = document.createElement("span");
    c.className = "chat-reaction-count";
    c.textContent = String(nicks.length);
    btn.appendChild(c);
    btn.title = nicks.join(", ");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      sendChatReaction(String(messageId), emo);
    });
    bar.appendChild(btn);
  }

  for (const emo of activeList) {
    makeReactionPill(emo);
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "chat-reaction-add";
  addBtn.textContent = "＋";
  addBtn.setAttribute("aria-label", "Добавить реакцию");
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = bar.querySelector(".chat-reaction-picker-inline") != null;
    closeAllReactionPickers();
    if (wasOpen) {
      return;
    }
    const pickerRow = document.createElement("div");
    pickerRow.className = "chat-reaction-picker-inline";
    for (const emo of QUICK_REACTION_EMOJIS) {
      const pe = document.createElement("button");
      pe.type = "button";
      pe.className = "chat-reaction-picker-btn";
      pe.textContent = emo;
      pe.setAttribute("aria-label", `Реакция ${emo}`);
      pe.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeAllReactionPickers();
        sendChatReaction(String(messageId), emo);
      });
      pickerRow.appendChild(pe);
    }
    bar.appendChild(pickerRow);
  });
  bar.appendChild(addBtn);
}

function buildChatMessageLine({ id, nickname, text, createdAt, imageMime, imageData, reactions }) {
  const line = document.createElement("div");
  line.className = "chat-line";
  if (id != null && id !== "") {
    line.dataset.messageId = String(id);
  }
  const head = document.createElement("div");
  head.className = "chat-line-head";
  const meta = document.createElement("div");
  meta.className = "chat-meta";
  meta.textContent = `${nickname} · ${formatChatTime(createdAt)}`;
  head.appendChild(meta);
  if (id != null && id !== "" && myNickname && nickname === myNickname) {
    const menuWrap = document.createElement("div");
    menuWrap.className = "chat-msg-menu-wrap";
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "btn-msg-ellipsis";
    menuBtn.textContent = "⋮";
    menuBtn.setAttribute("aria-label", "Действия с сообщением");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.setAttribute("aria-haspopup", "true");
    const dd = document.createElement("div");
    dd.className = "chat-msg-dropdown";
    dd.setAttribute("role", "menu");
    dd.hidden = true;
    const editItem = document.createElement("button");
    editItem.type = "button";
    editItem.className = "chat-msg-menu-item";
    editItem.setAttribute("role", "menuitem");
    editItem.textContent = "Изменить";
    editItem.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeAllChatMessageMenus();
      beginInlineEditChatLine(line, String(id));
    });
    const delItem = document.createElement("button");
    delItem.type = "button";
    delItem.className = "chat-msg-menu-item chat-msg-menu-item-danger";
    delItem.setAttribute("role", "menuitem");
    delItem.textContent = "Удалить";
    delItem.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeAllChatMessageMenus();
      requestDeleteChatMessage(String(id));
    });
    dd.appendChild(editItem);
    dd.appendChild(delItem);
    menuBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const opening = dd.hidden;
      closeAllChatMessageMenus();
      if (opening) {
        dd.hidden = false;
        menuBtn.setAttribute("aria-expanded", "true");
      }
    });
    menuWrap.appendChild(menuBtn);
    menuWrap.appendChild(dd);
    head.appendChild(menuWrap);
  }
  const body = document.createElement("div");
  body.className = "chat-line-body";
  if (imageData && imageMime) {
    const img = document.createElement("img");
    img.className = "chat-image";
    img.src = `data:${imageMime};base64,${imageData}`;
    img.alt = "фото в чате";
    img.loading = "lazy";
    body.appendChild(img);
  }
  const caption = (text || "").trim();
  if (caption) {
    const textEl = document.createElement("div");
    textEl.className = "chat-text";
    textEl.textContent = caption;
    body.appendChild(textEl);
  }
  line.appendChild(head);
  line.appendChild(body);
  renderReactionsStrip(line, id != null && id !== "" ? String(id) : "", reactions);
  return line;
}

function appendChatMessage(payload) {
  if (!chatLog) {
    return;
  }
  chatLog.appendChild(buildChatMessageLine(payload));
  chatLog.scrollTop = chatLog.scrollHeight;
}

function beginInlineEditChatLine(line, id) {
  closeAllChatMessageMenus();
  if (!line || line.querySelector(".chat-edit-wrap")) {
    return;
  }
  const body = line.querySelector(".chat-line-body");
  if (!body) {
    return;
  }
  const hasImg = body.querySelector(".chat-image") !== null;
  const textEl = body.querySelector(".chat-text");
  const current = textEl ? textEl.textContent : "";
  const hidden = [];
  for (const ch of Array.from(body.children)) {
    if (ch.classList.contains("chat-edit-wrap")) {
      continue;
    }
    hidden.push(ch);
    ch.style.display = "none";
  }
  const wrap = document.createElement("div");
  wrap.className = "chat-edit-wrap";
  const ta = document.createElement("textarea");
  ta.className = "chat-edit-field";
  ta.maxLength = 500;
  ta.value = current;
  ta.rows = 3;
  const btns = document.createElement("div");
  btns.className = "chat-edit-btns";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "btn-primary";
  save.textContent = "Сохранить";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Отмена";
  function restoreBody() {
    wrap.remove();
    for (const ch of hidden) {
      ch.style.display = "";
    }
  }
  cancel.addEventListener("click", (ev) => {
    ev.stopPropagation();
    restoreBody();
  });
  save.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const trimmed = ta.value.trim().slice(0, 500);
    if (!trimmed && !hasImg) {
      setStatus("Для сообщения без фото нужен текст.");
      return;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN || !joinedRoom) {
      setStatus("Нет соединения.");
      return;
    }
    try {
      socket.send(JSON.stringify({ type: "chat-edit", id: String(id), text: trimmed }));
    } catch (e) {
      console.error(e);
      setStatus("Не удалось отправить изменение.");
      return;
    }
    restoreBody();
  });
  btns.appendChild(save);
  btns.appendChild(cancel);
  wrap.appendChild(ta);
  wrap.appendChild(btns);
  body.appendChild(wrap);
  ta.focus();
}

function requestDeleteChatMessage(id) {
  if (!id) {
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN || !joinedRoom) {
    setStatus("Нет соединения.");
    return;
  }
  try {
    socket.send(JSON.stringify({ type: "chat-delete", id }));
  } catch (e) {
    console.error(e);
    setStatus("Не удалось удалить сообщение.");
  }
}

function applyChatMessageUpdated(msg) {
  const id =
    msg.id != null ? String(msg.id) : msg._id != null ? String(msg._id) : "";
  if (!id || !chatLog) {
    return;
  }
  const old = chatLineElById(id);
  if (!old) {
    console.warn("chat-message-updated: нет строки в DOM для id", id);
    setStatus("Не удалось обновить сообщение в интерфейсе — обновите страницу.");
    return;
  }
  const react =
    msg.reactions != null && typeof msg.reactions === "object" ? msg.reactions : {};
  const fresh = buildChatMessageLine({
    id,
    nickname: msg.nickname,
    text: msg.text,
    createdAt: msg.createdAt,
    imageMime: msg.imageMime,
    imageData: msg.imageData,
    reactions: react,
  });
  old.replaceWith(fresh);
}

function applyChatMessageReactions(msg) {
  const id = msg.id != null ? String(msg.id) : "";
  if (!id || !chatLog) {
    return;
  }
  const line = chatLineElById(id);
  if (!line) {
    return;
  }
  const react = msg.reactions != null && typeof msg.reactions === "object" ? msg.reactions : {};
  renderReactionsStrip(line, id, react);
}

function applyChatMessageDeleted(id) {
  if (id == null) {
    return;
  }
  const line = chatLineElById(id);
  if (line) {
    line.remove();
  }
}

function renderChatHistory(messages) {
  if (!chatLog) {
    return;
  }
  chatLog.innerHTML = "";
  for (const m of messages) {
    appendChatMessage({
      id: m.id,
      nickname: m.nickname,
      text: m.text,
      createdAt: m.createdAt,
      imageMime: m.imageMime,
      imageData: m.imageData,
      reactions: m.reactions != null && typeof m.reactions === "object" ? m.reactions : {},
    });
  }
}

function sendChat() {
  if (!joinedRoom) {
    setStatus("Сначала войдите в комнату.");
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    setStatus("Нет соединения. Обновите страницу.");
    return;
  }
  const text = chatInput.value.trim();
  if (!text) {
    return;
  }
  try {
    socket.send(JSON.stringify({ type: "chat", text }));
    chatInput.value = "";
  } catch (error) {
    console.error(error);
    setStatus("Не удалось отправить сообщение.");
  }
}

function clipboardLooksLikeImage(cd) {
  if (!cd) {
    return false;
  }
  if (cd.types) {
    for (let i = 0; i < cd.types.length; i++) {
      const t = String(cd.types[i]).toLowerCase();
      if (t.startsWith("image/") || t === "files") {
        return true;
      }
    }
  }
  if (cd.files && cd.files.length > 0) {
    const f = cd.files[0];
    const t = String(f.type || "").toLowerCase();
    if (t.startsWith("image/") || t === "" || t === "application/octet-stream") {
      return true;
    }
  }
  if (cd.items) {
    for (let i = 0; i < cd.items.length; i++) {
      const it = cd.items[i];
      if (it.kind !== "file") {
        continue;
      }
      const ty = String(it.type || "").toLowerCase();
      if (ty.startsWith("image/") || ty === "" || ty === "application/octet-stream") {
        return true;
      }
    }
  }
  return false;
}

function imageFileFromClipboardData(cd) {
  if (!cd) {
    return null;
  }
  if (cd.items && cd.items.length) {
    for (let i = 0; i < cd.items.length; i++) {
      const item = cd.items[i];
      if (item.kind !== "file") {
        continue;
      }
      let file = null;
      try {
        file = item.getAsFile();
      } catch (_) {
        continue;
      }
      if (!file || file.size === 0) {
        continue;
      }
      const ty = String(file.type || item.type || "").toLowerCase();
      if (ty.startsWith("image/") || ty === "" || ty === "application/octet-stream") {
        return file;
      }
    }
  }
  if (cd.files && cd.files.length) {
    for (let i = 0; i < cd.files.length; i++) {
      const f = cd.files[i];
      const t = String(f.type || "").toLowerCase();
      if (t.startsWith("image/")) {
        return f;
      }
    }
    const f0 = cd.files[0];
    if (f0) {
      const t0 = String(f0.type || "").toLowerCase();
      if (!t0 || t0 === "application/octet-stream") {
        return f0;
      }
    }
  }
  return null;
}

function snapshotClipboardText(cd) {
  let plain = "";
  let html = "";
  if (!cd || typeof cd.getData !== "function") {
    return { plain, html };
  }
  try {
    plain = cd.getData("text/plain") || "";
  } catch (_) {}
  try {
    html = cd.getData("text/html") || "";
  } catch (_) {}
  return { plain, html };
}

async function imageFileFromClipboardTextSnapshot(snap) {
  const plain = snap && snap.plain;
  try {
    if (plain && /^data:image\//i.test(plain.trim())) {
      const res = await fetch(plain.trim());
      const blob = await res.blob();
      if (blob && blob.size > 0) {
        return new File([blob], "paste.png", { type: blob.type || "image/png" });
      }
    }
  } catch (_) {}
  const html = snap && snap.html;
  try {
    if (html) {
      const m = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
      if (m && /^data:image\//i.test(m[1])) {
        const res = await fetch(m[1]);
        const blob = await res.blob();
        if (blob && blob.size > 0) {
          return new File([blob], "paste.png", { type: blob.type || "image/png" });
        }
      }
    }
  } catch (_) {}
  return null;
}

async function sendChatImage(file, caption) {
  if (!joinedRoom) {
    setStatus("Сначала войдите в комнату.");
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    setStatus("Нет соединения. Обновите страницу.");
    return;
  }
  if (!file) {
    setStatus("Нужен файл-картинка.");
    return;
  }
  const ftype = String(file.type || "");
  if (ftype && !ftype.startsWith("image/") && ftype !== "application/octet-stream") {
    setStatus("Нужен файл-картинка.");
    return;
  }
  const cap = (caption != null ? caption : chatInput && chatInput.value ? chatInput.value : "").trim().slice(0, 500);
  setStatus("Готовлю фото…");
  try {
    let work = file;
    try {
      const buf = await file.arrayBuffer();
      work = new File([buf], file.name || "paste.png", {
        type: file.type || "image/png",
      });
    } catch (e) {
      console.warn("file buffer copy", e);
    }
    const { mime, data } = await prepareImageForChat(work);
    if (!data || data.length < 32) {
      setStatus("Пустой снимок — попробуйте скопировать картинку снова.");
      return;
    }
    if (data.length > 2_400_000) {
      setStatus("Фото слишком большое — попробуйте другое или уменьшите.");
      return;
    }
    socket.send(
      JSON.stringify({
        type: "chat",
        text: cap,
        image: { mime, data },
      })
    );
    if (chatInput) {
      chatInput.value = "";
    }
    setStatus(`В сети как ${myNickname}`);
  } catch (err) {
    console.error(err);
    setStatus("Не удалось обработать изображение.");
  }
}

function setMicButtonState() {
  const labelOn = "Выключить микрофон";
  const labelOff = "Включить микрофон";
  const titleOn = "Микрофон включён — нажмите, чтобы выключить";
  const titleOff = "Микрофон выключен — нажмите, чтобы включить";
  if (micBtnIcon) {
    micBtnIcon.innerHTML = micEnabled ? MIC_ICON_ON : MIC_ICON_OFF;
  }
  if (micBtn) {
    micBtn.setAttribute("aria-label", micEnabled ? labelOn : labelOff);
    micBtn.setAttribute("title", micEnabled ? titleOn : titleOff);
  }
}

function setMicEnabled(enabled) {
  micEnabled = enabled;
  try {
    localStorage.setItem(LS_MIC_ENABLED, enabled ? "1" : "0");
  } catch (_) {}
  if (localStream) {
    for (const track of localStream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }
  setMicButtonState();
}

function getPeerVolumePercent(peerNickname) {
  if (!volumePercentByPeer.has(peerNickname)) {
    volumePercentByPeer.set(peerNickname, 100);
  }
  return volumePercentByPeer.get(peerNickname);
}

function applyPeerGain(peerNickname) {
  const g = peerAudioGraphs.get(peerNickname);
  if (!g || !g.gainNode) {
    return;
  }
  const pct = getPeerVolumePercent(peerNickname);
  const hear = hearByPeer.get(peerNickname) !== false;
  g.gainNode.gain.value = hear ? pct / 100 : 0;
}

function teardownPeerAudioGraph(peerNickname) {
  const g = peerAudioGraphs.get(peerNickname);
  if (!g) {
    return;
  }
  try {
    if (g.source) {
      g.source.disconnect();
    }
    if (g.gainNode) {
      g.gainNode.disconnect();
    }
  } catch (_) {}
  peerAudioGraphs.delete(peerNickname);

  const audio = remoteAudioByPeer.get(peerNickname);
  if (audio) {
    audio.srcObject = null;
    if (audio.parentNode) {
      audio.parentNode.removeChild(audio);
    }
    remoteAudioByPeer.delete(peerNickname);
  }
}

function hookRemoteStream(peerNickname, stream) {
  teardownPeerAudioGraph(peerNickname);

  const ctx = getOrCreateAudioContext();
  if (!ctx) {
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.playsInline = true;
    audio.setAttribute("playsinline", "");
    audio.srcObject = stream;
    audio.volume = Math.min(1, getPeerVolumePercent(peerNickname) / 100);
    audio.muted = hearByPeer.get(peerNickname) === false;
    remoteAudioByPeer.set(peerNickname, audio);
    document.body.appendChild(audio);
    audio.play().catch(() => {});
    return;
  }

  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.playsInline = true;
  audio.setAttribute("playsinline", "");
  audio.muted = true;
  audio.volume = 0;
  audio.srcObject = stream;
  remoteAudioByPeer.set(peerNickname, audio);
  document.body.appendChild(audio);

  const source = ctx.createMediaStreamSource(stream);
  const gainNode = ctx.createGain();
  source.connect(gainNode);
  gainNode.connect(ctx.destination);
  peerAudioGraphs.set(peerNickname, { source, gainNode, stream });
  applyPeerGain(peerNickname);
}

function renderParticipants() {
  participantsEl.innerHTML = "";

  for (const peerNickname of Array.from(peers.keys()).sort()) {
    const li = document.createElement("li");

    const top = document.createElement("div");
    top.className = "peer-top";

    const nameSpan = document.createElement("span");
    const isMuted = hearByPeer.get(peerNickname) === false;
    nameSpan.className = "peer-name" + (isMuted ? " muted-label" : "");
    nameSpan.textContent = peerNickname;

    top.appendChild(nameSpan);
    li.appendChild(top);

    const volRow = document.createElement("div");
    volRow.className = "peer-vol-row";
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "200";
    range.value = String(getPeerVolumePercent(peerNickname));
    range.title = "Громкость 0–200%";
    range.addEventListener("input", () => {
      const v = Math.max(0, Math.min(200, Number(range.value) || 0));
      volumePercentByPeer.set(peerNickname, v);
      valSpan.textContent = `${v}%`;
      applyPeerGain(peerNickname);

      const a = remoteAudioByPeer.get(peerNickname);
      if (a && !peerAudioGraphs.has(peerNickname)) {
        a.volume = Math.min(1, v / 100);
      }
      persistPeerAudioSettings();
    });
    const valSpan = document.createElement("span");
    valSpan.className = "peer-vol-val";
    valSpan.textContent = `${getPeerVolumePercent(peerNickname)}%`;
    volRow.appendChild(range);
    volRow.appendChild(valSpan);
    li.appendChild(volRow);

    const actions = document.createElement("div");
    actions.className = "peer-actions";
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = isMuted ? "Включить звук" : "Заглушить";
    toggleBtn.addEventListener("click", () => {
      const nextHear = !(hearByPeer.get(peerNickname) !== false);
      hearByPeer.set(peerNickname, nextHear);

      const audio = remoteAudioByPeer.get(peerNickname);
      if (audio) {
        audio.muted = !nextHear;
      }
      applyPeerGain(peerNickname);
      persistPeerAudioSettings();

      renderParticipants();
    });
    actions.appendChild(toggleBtn);
    li.appendChild(actions);

    participantsEl.appendChild(li);
  }

  syncAdminParticipantListIfVisible();
}

function updateAdminJoinHint() {
  if (adminJoinHint) {
    adminJoinHint.hidden = joinedRoom;
  }
  if (adminAuthSubmit) {
    adminAuthSubmit.disabled = !joinedRoom;
  }
}

function clearCachedAdminSession() {
  cachedAdminSecret = null;
  adminServerPeers = [];
  pendingAdminSecretAttempt = null;
  awaitingAdminVerifyResponse = false;
  if (adminPasswordInput) {
    adminPasswordInput.value = "";
  }
  if (adminAuthError) {
    adminAuthError.textContent = "";
    adminAuthError.hidden = true;
  }
}

function updateAdminModalLayout() {
  const authed = Boolean(cachedAdminSecret);
  if (adminAuthSection) {
    adminAuthSection.hidden = authed;
  }
  if (adminPanelBody) {
    adminPanelBody.hidden = !authed;
  }
  updateAdminJoinHint();
}

function requestAdminPeerList() {
  if (!cachedAdminSecret || !socket || socket.readyState !== WebSocket.OPEN || !joinedRoom) {
    return;
  }
  socket.send(JSON.stringify({ type: "admin-peers", secret: cachedAdminSecret }));
}

function notifyAdminRosterRefresh() {
  if (!adminModal || adminModal.hidden || !cachedAdminSecret) {
    return;
  }
  requestAdminPeerList();
}

function submitAdminPassword() {
  if (adminAuthError) {
    adminAuthError.hidden = true;
    adminAuthError.textContent = "";
  }
  if (!joinedRoom || !socket || socket.readyState !== WebSocket.OPEN) {
    if (adminAuthError) {
      adminAuthError.textContent = "Нужно быть в комнате.";
      adminAuthError.hidden = false;
    }
    return;
  }
  const secret = String(adminPasswordInput ? adminPasswordInput.value : "").trim();
  if (!secret) {
    if (adminAuthError) {
      adminAuthError.textContent = "Введите пароль.";
      adminAuthError.hidden = false;
    }
    return;
  }
  pendingAdminSecretAttempt = secret;
  awaitingAdminVerifyResponse = true;
  socket.send(JSON.stringify({ type: "admin-verify", secret }));
}

function renderAdminParticipantList() {
  if (!adminParticipantsList) {
    return;
  }
  adminParticipantsList.innerHTML = "";
  if (!cachedAdminSecret) {
    return;
  }
  if (!joinedRoom || !myNickname) {
    const li = document.createElement("li");
    li.className = "admin-participant-hint";
    li.textContent = "Нет подключения к комнате.";
    adminParticipantsList.appendChild(li);
    return;
  }
  const sorted = [...adminServerPeers].sort((a, b) => a.localeCompare(b, "ru"));
  if (sorted.length === 0) {
    const li = document.createElement("li");
    li.className = "admin-participant-hint";
    li.textContent = "Список пуст.";
    adminParticipantsList.appendChild(li);
    return;
  }
  for (const name of sorted) {
    const li = document.createElement("li");
    li.className = "admin-participant-row";
    const span = document.createElement("span");
    span.className = "admin-participant-name";
    span.textContent = name === myNickname ? `${name} (вы)` : name;
    li.appendChild(span);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-kick";
    btn.textContent = "Исключить";
    btn.setAttribute("aria-label", `Исключить ${name} из комнаты`);
    btn.addEventListener("click", () => {
      requestKickParticipant(name);
    });
    li.appendChild(btn);
    adminParticipantsList.appendChild(li);
  }
}

function syncAdminParticipantListIfVisible() {
  if (!adminModal || adminModal.hidden) {
    return;
  }
  if (cachedAdminSecret && socket && socket.readyState === WebSocket.OPEN && joinedRoom) {
    requestAdminPeerList();
  } else {
    renderAdminParticipantList();
  }
}

function requestKickParticipant(targetNick) {
  if (!targetNick || !cachedAdminSecret || !socket || socket.readyState !== WebSocket.OPEN || !joinedRoom) {
    return;
  }
  socket.send(JSON.stringify({ type: "admin-kick", target: targetNick, secret: cachedAdminSecret }));
}

function sendSignal(target, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(
    JSON.stringify({
      type: "signal",
      target,
      payload,
    })
  );
}

async function createPeerConnection(peerNickname, initiator) {
  if (peers.has(peerNickname)) {
    return peers.get(peerNickname);
  }

  const pc = new RTCPeerConnection(rtcConfig);
  peers.set(peerNickname, pc);
  seedPeerAudioFromStorage(peerNickname);

  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.onicecandidate = (event) => {
    if (!event.candidate) {
      return;
    }
    const c = event.candidate;
    const plain = c.toJSON ? c.toJSON() : { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex };
    sendSignal(peerNickname, { candidate: plain });
  };

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    hookRemoteStream(peerNickname, stream);
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === "failed" || state === "closed") {
      const t = disconnectTimers.get(peerNickname);
      if (t) {
        clearTimeout(t);
      }
      disconnectTimers.delete(peerNickname);
      removePeer(peerNickname);
      return;
    }
    if (state === "disconnected") {
      if (disconnectTimers.has(peerNickname)) {
        return;
      }
      const t = setTimeout(() => {
        disconnectTimers.delete(peerNickname);
        if (peers.get(peerNickname) === pc && pc.connectionState === "disconnected") {
          removePeer(peerNickname);
        }
      }, 20000);
      disconnectTimers.set(peerNickname, t);
      return;
    }
    if (state === "connected" || state === "connecting") {
      const t = disconnectTimers.get(peerNickname);
      if (t) {
        clearTimeout(t);
        disconnectTimers.delete(peerNickname);
      }
    }
  };

  if (initiator) {
    const offer = await pc.createOffer({ offerToReceiveAudio: true, iceRestart: false });
    await pc.setLocalDescription(offer);
    sendSignal(peerNickname, { description: sdpPayload(pc.localDescription) });
  }

  renderParticipants();
  return pc;
}

function removePeer(peerNickname) {
  const t = disconnectTimers.get(peerNickname);
  if (t) {
    clearTimeout(t);
  }
  disconnectTimers.delete(peerNickname);

  const pc = peers.get(peerNickname);
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.close();
  }

  peers.delete(peerNickname);
  hearByPeer.delete(peerNickname);
  pendingIceByPeer.delete(peerNickname);
  volumePercentByPeer.delete(peerNickname);
  teardownPeerAudioGraph(peerNickname);

  renderParticipants();
}

async function handleSignal(from, payload) {
  const pc = await createPeerConnection(from, false);

  if (payload.description) {
    await pc.setRemoteDescription(new RTCSessionDescription(payload.description));
    if (payload.description.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(from, { description: sdpPayload(pc.localDescription) });
    }
    await flushPendingIce(from);
    return;
  }

  if (payload.candidate) {
    if (!pc.remoteDescription) {
      pushPendingIce(from, payload.candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (error) {
      console.error("Failed to add ICE candidate", error);
    }
  }
}

function connectSocket() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${protocol}://${location.host}`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    const nick = (nicknameInput && nicknameInput.value.trim()) || myNickname;
    if (!nick) {
      setStatus("Введите ник и нажмите «Войти» снова.");
      try {
        socket.close();
      } catch (_) {}
      joinBtn.disabled = false;
      nicknameInput.disabled = false;
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
      }
      return;
    }
    myNickname = nick;
    setStatus("Подключение…");
    socket.send(
      JSON.stringify({
        type: "join",
        nickname: myNickname,
      })
    );
  };

  socket.onerror = () => {
    console.warn("WebSocket error");
    if (!joinedRoom) {
      setStatus("Ошибка WebSocket — проверьте сервер и URL.");
      joinBtn.disabled = false;
      nicknameInput.disabled = false;
      if (leaveBtn) {
        leaveBtn.disabled = true;
      }
    }
  };

  socket.onmessage = async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error("Bad WebSocket message", error);
      return;
    }

    switch (message.type) {
      case "hello":
        serverChatMessageOps = message.chatMessageOps === true;
        if (joinedRoom && serverChatMessageOps === false) {
          setStatus(
            `${myNickname ? `В сети как ${myNickname}. ` : ""}На сервере нет правок чата — обновите backend (см. docker-compose: том ./server или rebuild).`
          );
        }
        break;
      case "join-accepted":
        myNickname = message.nickname;
        joinBtn.disabled = true;
        nicknameInput.disabled = true;
        nicknameInput.value = message.nickname;
        if (leaveBtn) {
          leaveBtn.disabled = false;
        }
        enqueueRtc(async () => {
          joinedRoom = true;
          setCookie(NICK_COOKIE, myNickname || message.nickname, NICK_COOKIE_MAX_AGE);
          sessionStorage.setItem(SS_JOINED, "1");
          sessionStorage.setItem(SS_NICK, message.nickname);
          {
            let line = `В сети как ${message.nickname}`;
            if (serverChatMessageOps === false) {
              line +=
                ". Сервер устарел: нет изменения/удаления сообщений — перезапустите с актуальным server/.";
            }
            setStatus(line);
          }
          if (micBtn) {
            micBtn.disabled = false;
          }
          setChatEnabled(true);
          for (const peerNickname of message.peers) {
            await createPeerConnection(peerNickname, false);
          }
        });
        await rtcChain;
        updateAdminJoinHint();
        break;
      case "chat-history":
        renderChatHistory(message.messages || []);
        break;
      case "chat-message":
        appendChatMessage({
          id: message.id,
          nickname: message.nickname,
          text: message.text,
          createdAt: message.createdAt,
          imageMime: message.imageMime,
          imageData: message.imageData,
          reactions:
            message.reactions != null && typeof message.reactions === "object"
              ? message.reactions
              : {},
        });
        break;
      case "chat-message-updated":
        applyChatMessageUpdated(message);
        break;
      case "chat-message-reactions":
        applyChatMessageReactions(message);
        break;
      case "chat-message-deleted":
        applyChatMessageDeleted(message.id);
        break;
      case "join-rejected":
        joinedRoom = false;
        setStatus(`Вход отклонён: ${message.reason}`);
        joinBtn.disabled = false;
        nicknameInput.disabled = false;
        setChatEnabled(false);
        if (leaveBtn) {
          leaveBtn.disabled = true;
        }
        clearRejoinHint();
        updateAdminJoinHint();
        break;
      case "peer-joined":
        enqueueRtc(async () => {
          await createPeerConnection(message.nickname, true);
          setStatus(`${message.nickname} вошёл`);
        });
        await rtcChain;
        notifyAdminRosterRefresh();
        break;
      case "peer-left":
        removePeer(message.nickname);
        setStatus(`${message.nickname} вышел`);
        notifyAdminRosterRefresh();
        break;
      case "admin-verify-ok":
        awaitingAdminVerifyResponse = false;
        cachedAdminSecret = pendingAdminSecretAttempt;
        pendingAdminSecretAttempt = null;
        if (adminPasswordInput) {
          adminPasswordInput.value = "";
        }
        if (adminAuthError) {
          adminAuthError.hidden = true;
        }
        updateAdminModalLayout();
        requestAdminPeerList();
        break;
      case "admin-peers-result":
        adminServerPeers = Array.isArray(message.peers) ? message.peers : [];
        renderAdminParticipantList();
        break;
      case "kicked":
        clearCachedAdminSession();
        updateAdminModalLayout();
        pendingKickedDisconnectStatus = message.reason || "Вас исключили из комнаты.";
        setStatus(pendingKickedDisconnectStatus);
        clearRejoinHint();
        forceDisconnectClient();
        break;
      case "signal":
        enqueueRtc(() => handleSignal(message.from, message.payload));
        await rtcChain;
        break;
      case "signal-error":
        console.warn("Signal error:", message);
        break;
      case "error":
        console.error("Server error:", message.message);
        if (awaitingAdminVerifyResponse) {
          awaitingAdminVerifyResponse = false;
          pendingAdminSecretAttempt = null;
          if (adminAuthError) {
            let errText = message.message || "Ошибка.";
            if (/unknown message type:\s*admin-verify/i.test(errText)) {
              errText =
                "Сервер старой версии (нет admin-verify). Остановите процесс и снова запустите npm start в папке сервера или выполните docker compose build && docker compose up.";
            }
            adminAuthError.textContent = errText;
            adminAuthError.hidden = false;
          }
          break;
        }
        {
          let errText2 = message.message || "Ошибка.";
          if (/unknown message type:\s*chat-(?:edit|delete)/i.test(errText2)) {
            errText2 =
              "Сервер без правок чата (старый процесс). Перезапустите: npm start из папки local-voicechat или docker compose down && docker compose up (в compose смонтирован ./server).";
          }
          setStatus(`Ошибка: ${errText2}`);
        }
        break;
      default:
        break;
    }
  };

  socket.onclose = () => {
    try {
      clearCachedAdminSession();
      updateAdminModalLayout();
      renderAdminParticipantList();
      const skipGenericDisconnectMsg = pendingKickedDisconnectStatus !== null;
      if (pendingKickedDisconnectStatus !== null) {
        pendingKickedDisconnectStatus = null;
      }
      joinedRoom = false;
      socket = null;
      rtcChain = Promise.resolve();
      if (!skipGenericDisconnectMsg) {
        setStatus("Отключено");
      }
      if (micBtn) {
        micBtn.disabled = true;
      }
      setChatEnabled(false);
      joinBtn.disabled = false;
      nicknameInput.disabled = false;
      if (leaveBtn) {
        leaveBtn.disabled = true;
      }
      if (chatLog) {
        chatLog.innerHTML = "";
      }
      for (const peerNickname of Array.from(peers.keys())) {
        removePeer(peerNickname);
      }
    } catch (_) {
      /* страница может уже выгружаться */
    }
  };
}

function updateThemeButtonLabel() {
  if (!menuThemeBtn) {
    return;
  }
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  menuThemeBtn.textContent = isLight ? "Тема: светлая" : "Тема: тёмная";
  menuThemeBtn.setAttribute("aria-pressed", isLight ? "false" : "true");
}

function setChatMenuOpen(open) {
  if (!chatDropdown || !chatMenuBtn) {
    return;
  }
  chatDropdown.hidden = !open;
  chatMenuBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeChatMenu() {
  setChatMenuOpen(false);
}

function openAdminModal() {
  if (adminModal) {
    adminModal.hidden = false;
  }
  closeChatMenu();
  updateAdminModalLayout();
  if (cachedAdminSecret) {
    requestAdminPeerList();
  } else {
    renderAdminParticipantList();
  }
}

function closeAdminModal() {
  if (adminModal) {
    adminModal.hidden = true;
  }
}

if (chatMenuBtn && chatDropdown) {
  chatMenuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setChatMenuOpen(chatDropdown.hidden);
  });
}

document.addEventListener("click", () => {
  closeChatMenu();
  closeAllChatMessageMenus();
  closeAllReactionPickers();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") {
    return;
  }
  closeChatMenu();
  closeAllChatMessageMenus();
  closeAllReactionPickers();
  closeAdminModal();
});

if (menuThemeBtn) {
  menuThemeBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(LS_THEME, next);
    updateThemeButtonLabel();
    closeChatMenu();
  });
}

if (menuAdminBtn) {
  menuAdminBtn.addEventListener("click", () => {
    openAdminModal();
  });
}

if (adminAuthSubmit) {
  adminAuthSubmit.addEventListener("click", () => {
    submitAdminPassword();
  });
}

if (adminPasswordInput) {
  adminPasswordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitAdminPassword();
    }
  });
}

if (adminLogoutBtn) {
  adminLogoutBtn.addEventListener("click", () => {
    clearCachedAdminSession();
    updateAdminModalLayout();
    renderAdminParticipantList();
    if (adminPasswordInput) {
      adminPasswordInput.focus();
    }
  });
}

if (adminModalClose) {
  adminModalClose.addEventListener("click", () => {
    closeAdminModal();
  });
}

if (adminModal) {
  adminModal.addEventListener("click", (e) => {
    if (e.target === adminModal) {
      closeAdminModal();
    }
  });
}

updateThemeButtonLabel();

(function initMicUiFromStorage() {
  try {
    micEnabled = localStorage.getItem(LS_MIC_ENABLED) !== "0";
  } catch (_) {}
  setMicButtonState();
})();

async function join(options = {}) {
  const fromAutoRejoin = options.fromAutoRejoin === true;

  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    setStatus("Нужен ник.");
    return;
  }

  if (joinedRoom) {
    setStatus("Вы уже в комнате.");
    return;
  }

  if (!window.isSecureContext) {
    const httpsPort = document.body.dataset.httpsPort || "3443";
    const host = location.hostname;
    const httpsHint =
      host === "localhost" || host === "127.0.0.1"
        ? " На localhost HTTP допустим, иначе https://localhost:" + httpsPort + "/"
        : ` Откройте https://${host}:${httpsPort}/ и примите сертификат.`;
    setStatus("Микрофон нужен в безопасном контексте (HTTPS или localhost)." + httpsHint);
    return;
  }

  forceDisconnectClient();
  myNickname = nickname;
  joinBtn.disabled = false;
  nicknameInput.disabled = false;

  try {
    await resumeAudioContextIfNeeded();
    localStream = await navigator.mediaDevices.getUserMedia(getAudioConstraints());
    setMicEnabled(localStorage.getItem(LS_MIC_ENABLED) !== "0");
    connectSocket();
  } catch (error) {
    console.error(error);
    if (!fromAutoRejoin) {
      clearRejoinHint();
    }
    if (fromAutoRejoin) {
      setStatus(
        "После обновления страницы нажмите «Войти» ещё раз — браузеру нужен жест для доступа к микрофону."
      );
    } else if (error && error.name === "NotAllowedError") {
      setStatus("Доступ к микрофону запрещён. Разрешите в настройках сайта.");
    } else if (error && error.name === "NotFoundError") {
      setStatus("Микрофон не найден.");
    } else {
      setStatus(`Нет доступа к микрофону (${error?.name || "ошибка"}).`);
    }
    joinBtn.disabled = false;
    nicknameInput.disabled = false;
  }
}

joinBtn.addEventListener("click", () => {
  void join({ fromAutoRejoin: false });
});

if (leaveBtn) {
  leaveBtn.addEventListener("click", () => {
    if (!joinedRoom) {
      return;
    }
    leaveRoom();
  });
}

function toggleMicFromUi() {
  setMicEnabled(!micEnabled);
}

if (micBtn) {
  micBtn.addEventListener("click", () => {
    toggleMicFromUi();
  });
}

chatSendBtn.addEventListener("click", () => {
  sendChat();
});

chatInput.addEventListener("keydown", (event) => {
  if (event.isComposing) {
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChat();
  }
});

async function onDocumentPasteForChat(event) {
  if (!joinedRoom) {
    return;
  }
  const target = event.target;
  if (target instanceof Element && target.closest("aside.sidebar")) {
    return;
  }
  const cd = event.clipboardData;
  const fileSync = imageFileFromClipboardData(cd);
  const textSnap = snapshotClipboardText(cd);
  const looksImage = fileSync != null || clipboardLooksLikeImage(cd);
  if (!looksImage) {
    return;
  }
  /** До любого await — иначе браузер успеет вставить текст по умолчанию и сорвёт отправку. */
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  let file = fileSync;
  if (!file) {
    file = await imageFileFromClipboardTextSnapshot(textSnap);
  }
  if (!file) {
    setStatus("Не удалось прочитать картинку из буфера — используйте кнопку «Фото» или другой снимок.");
    return;
  }
  const cap = chatInput && !chatInput.disabled ? chatInput.value.trim().slice(0, 500) : "";
  await sendChatImage(file, cap);
}

window.addEventListener("paste", onDocumentPasteForChat, true);

const CHAT_IMAGE_NAME_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|ico|heic|heif)$/i;

function fileLooksLikeChatImage(file) {
  if (!file || file.size === 0) {
    return false;
  }
  const t = String(file.type || "").toLowerCase();
  if (t.startsWith("image/") || t === "" || t === "application/octet-stream") {
    return true;
  }
  return CHAT_IMAGE_NAME_EXT.test(String(file.name || ""));
}

function dataTransferHasImageFile(dt) {
  if (!dt || !dt.types || dt.types.length === 0) {
    return false;
  }
  const lower = Array.from(dt.types).map((x) => String(x).toLowerCase());
  if (lower.includes("files")) {
    return true;
  }
  if (lower.some((t) => t.startsWith("image/"))) {
    return true;
  }
  if (lower.includes("application/x-moz-file")) {
    return true;
  }
  if (dt.items && dt.items.length) {
    for (let i = 0; i < dt.items.length; i++) {
      const it = dt.items[i];
      if (it.kind !== "file") {
        continue;
      }
      const ty = String(it.type || "").toLowerCase();
      if (ty.startsWith("image/") || ty === "" || ty === "application/octet-stream") {
        return true;
      }
    }
  }
  return false;
}

function pickImageFileFromDataTransfer(dt) {
  if (!dt) {
    return null;
  }
  if (dt.files && dt.files.length) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files[i];
      if (fileLooksLikeChatImage(f)) {
        return f;
      }
    }
  }
  if (dt.items && dt.items.length) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind !== "file") {
        continue;
      }
      let file = null;
      try {
        file = item.getAsFile();
      } catch (_) {
        continue;
      }
      if (fileLooksLikeChatImage(file)) {
        return file;
      }
    }
  }
  return null;
}

function onChatMainDragOver(e) {
  if (!joinedRoom || !dataTransferHasImageFile(e.dataTransfer)) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = "copy";
  if (chatMainEl) {
    chatMainEl.classList.add("chat-main-drag");
  }
}

function onChatMainDragLeave(e) {
  if (!chatMainEl) {
    return;
  }
  const rel = e.relatedTarget;
  if (!rel || !chatMainEl.contains(rel)) {
    chatMainEl.classList.remove("chat-main-drag");
  }
}

async function onChatMainDrop(e) {
  if (chatMainEl) {
    chatMainEl.classList.remove("chat-main-drag");
  }
  if (!joinedRoom) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  const file = pickImageFileFromDataTransfer(e.dataTransfer);
  if (!file) {
    setStatus("Перетащите файл-картинки (JPEG, PNG, GIF, WebP и др.).");
    return;
  }
  const cap = chatInput && !chatInput.disabled ? chatInput.value.trim().slice(0, 500) : "";
  await sendChatImage(file, cap);
}

if (chatMainEl) {
  chatMainEl.addEventListener("dragover", onChatMainDragOver, true);
  chatMainEl.addEventListener("dragleave", onChatMainDragLeave, true);
  chatMainEl.addEventListener("drop", onChatMainDrop, true);
  window.addEventListener("dragend", () => {
    chatMainEl.classList.remove("chat-main-drag");
  });
}

if (chatImageBtn && chatImageInput) {
  chatImageBtn.addEventListener("click", () => {
    chatImageInput.click();
  });
  chatImageInput.addEventListener("change", () => {
    const file = chatImageInput.files && chatImageInput.files[0];
    chatImageInput.value = "";
    if (file) {
      void sendChatImage(file, chatInput ? chatInput.value.trim() : "");
    }
  });
}

(function initFromStorage() {
  const c = getCookie(NICK_COOKIE);
  if (c && nicknameInput && !nicknameInput.value.trim()) {
    nicknameInput.value = c;
  }
})();

(function trySessionRejoin() {
  if (sessionStorage.getItem(SS_JOINED) !== "1") {
    return;
  }
  const nick = sessionStorage.getItem(SS_NICK);
  if (!nick) {
    return;
  }
  if (nicknameInput) {
    nicknameInput.value = nick;
  }
  setTimeout(() => {
    void join({ fromAutoRejoin: true });
  }, 0);
})();
