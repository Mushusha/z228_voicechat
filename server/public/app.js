const NICK_COOKIE = "zalupa228_nick";
const NICK_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
const SS_JOINED = "zalupa_vc_joined";
const SS_NICK = "zalupa_vc_nick";
const LS_THEME = "zalupa_theme";
const LS_PEER_AUDIO = "zalupa228_peer_audio";
const LS_MIC_ENABLED = "zalupa228_mic_on";
const LS_CHANNELS_CACHE = "zalupa228_channels_cache_v1";

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

async function leaveRoom() {
  clearRejoinHint();
  const s = socket;
  if (s && s.readyState === WebSocket.OPEN) {
    try {
      s.send(JSON.stringify({ type: "leave" }));
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  forceDisconnectClient();
  voiceMembersByChannel = {};
  voiceMicByNickname = {};
  if (chatLog) {
    chatLog.innerHTML = "";
  }
  setStatus("Вы вышли из комнаты.");
  syncAuthUi();
  renderChannelPanels();
  renderParticipants();
  renderOnlineParticipants();
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
  if (pendingRename) {
    try {
      clearTimeout(pendingRename.timer);
    } catch (_) {}
    pendingRename.resolve(false);
    pendingRename = null;
  }
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
  if (micToggleBottom) {
    micToggleBottom.disabled = true;
  }
  setChatEnabled(false);
  syncAuthUi();
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
const toolbarEl = document.querySelector(".toolbar");
const channelGroupsEl = document.getElementById("channelGroups");
const micBtn = document.getElementById("micBtn");
const micBtnIcon = document.getElementById("micBtnIcon");
const chatMenuBtn = document.getElementById("chatMenuBtn");
const chatDropdown = document.getElementById("chatDropdown");
const menuThemeBtn = document.getElementById("menuThemeBtn");
const menuAdminBtn = document.getElementById("menuAdminBtn");
const menuProfileBtn = document.getElementById("menuProfileBtn");
const menuDonateBtn = document.getElementById("menuDonateBtn");
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
const adminCreateTextChannelBtn = document.getElementById("adminCreateTextChannelBtn");
const adminCreateVoiceChannelBtn = document.getElementById("adminCreateVoiceChannelBtn");
const adminChannelsList = document.getElementById("adminChannelsList");
const statusEl = document.getElementById("status");
const participantsEl = document.getElementById("participants");
const onlineParticipantsEl = document.getElementById("onlineParticipants");
const chatLog = document.getElementById("chatLog");
const chatMainEl = document.querySelector(".chat-main");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatImageInput = document.getElementById("chatImageInput");
const chatImageBtn = document.getElementById("chatImageBtn");
const profileModal = document.getElementById("profileModal");
const profileNameInput = document.getElementById("profileNameInput");
const profileSaveBtn = document.getElementById("profileSaveBtn");
const profileCloseBtn = document.getElementById("profileCloseBtn");
const channelsModal = document.getElementById("channelsModal");
const textChannelSelect = document.getElementById("textChannelSelect");
const voiceChannelSelect = document.getElementById("voiceChannelSelect");
const channelsCloseBtn = document.getElementById("channelsCloseBtn");
const donateModal = document.getElementById("donateModal");
const donateCloseBtn = document.getElementById("donateCloseBtn");
const micToggleBottom = document.getElementById("micToggleBottom");
const allSoundToggleBtn = document.getElementById("allSoundToggleBtn");
const allSoundVolume = document.getElementById("allSoundVolume");
const allSoundVolumeVal = document.getElementById("allSoundVolumeVal");
const textChannelsList = document.getElementById("textChannelsList");
const voiceChannelsList = document.getElementById("voiceChannelsList");
const micDockBtn = document.getElementById("micDockBtn");
const soundDockBtn = document.getElementById("soundDockBtn");
const miniPopup = document.getElementById("miniPopup");

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
let textChannels = [{ id: "text-general", name: "Общий текст" }];
let voiceChannels = [{ id: "voice-general", name: "Общий голос" }];
let currentTextChannel = "text-general";
let currentVoiceChannel = "voice-general";
let textDetached = false;
let allSoundEnabled = true;
let allSoundPercent = 100;
let voiceMembersByChannel = {};
let voiceMicByNickname = {};
let pendingRename = null;

function syncAuthUi() {
  const hasSavedNick =
    Boolean(getCookie(NICK_COOKIE)) ||
    Boolean(sessionStorage.getItem(SS_NICK)) ||
    sessionStorage.getItem(SS_JOINED) === "1";
  if (toolbarEl) {
    toolbarEl.hidden = joinedRoom || hasSavedNick;
  }
  if (channelGroupsEl) {
    channelGroupsEl.hidden = !joinedRoom && !hasSavedNick;
  }
  if (joinBtn) {
    joinBtn.hidden = joinedRoom;
    joinBtn.disabled = joinedRoom;
  }
  if (leaveBtn) {
    leaveBtn.hidden = !joinedRoom;
    leaveBtn.disabled = !joinedRoom;
  }
  if (nicknameInput) {
    nicknameInput.hidden = joinedRoom || hasSavedNick;
    nicknameInput.disabled = joinedRoom;
  }
}

function onlineUsersList() {
  const users = new Set();
  for (const members of Object.values(voiceMembersByChannel)) {
    if (!Array.isArray(members)) {
      continue;
    }
    for (const name of members) {
      if (name) {
        users.add(name);
      }
    }
  }
  return Array.from(users).sort((a, b) => a.localeCompare(b, "ru"));
}

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

let rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

async function loadRtcConfig() {
  try {
    const r = await fetch("/api/rtc-config", { cache: "no-store" });
    if (!r.ok) {
      return;
    }
    const data = await r.json();
    if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      rtcConfig = { iceServers: data.iceServers };
    }
  } catch (e) {
    console.warn("rtc-config", e);
  }
}

/** Один инициатор на пару ников — иначе два offer (ICE glare) и голос не поднимается. */
function shouldInitiateWithPeer(peerNickname) {
  if (!myNickname || !peerNickname) {
    return true;
  }
  return myNickname.localeCompare(peerNickname, "ru") < 0;
}

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
  // Всегда стартуем со слышимым собеседником: старые mute-настройки
  // могли "залипать" между сессиями и создавали эффект "не слышу никого".
  hearByPeer.set(peerNickname, true);
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

function openSimpleModal(modalEl) {
  if (modalEl) {
    modalEl.hidden = false;
  }
}

function closeSimpleModal(modalEl) {
  if (modalEl) {
    modalEl.hidden = true;
  }
}

function renderChannelSelect(selectEl, channels, currentId) {
  if (!selectEl) {
    return;
  }
  selectEl.innerHTML = "";
  for (const ch of channels) {
    const opt = document.createElement("option");
    opt.value = ch.id;
    opt.textContent = ch.name;
    if (ch.id === currentId) {
      opt.selected = true;
    }
    selectEl.appendChild(opt);
  }
}

function applyChannelsState(message) {
  if (Array.isArray(message.textChannels)) {
    textChannels = message.textChannels;
  }
  if (Array.isArray(message.voiceChannels)) {
    voiceChannels = message.voiceChannels;
  }
  if (typeof message.currentText === "string" && message.currentText) {
    currentTextChannel = message.currentText;
  }
  if (typeof message.currentVoice === "string" && message.currentVoice) {
    currentVoiceChannel = message.currentVoice;
  }
  if (message.voiceMembers && typeof message.voiceMembers === "object") {
    voiceMembersByChannel = message.voiceMembers;
  }
  if (message.voiceMic && typeof message.voiceMic === "object") {
    voiceMicByNickname = message.voiceMic;
  }
  try {
    localStorage.setItem(
      LS_CHANNELS_CACHE,
      JSON.stringify({
        textChannels,
        voiceChannels,
      })
    );
  } catch (_) {}
  renderChannelSelect(textChannelSelect, textChannels, currentTextChannel);
  renderChannelSelect(voiceChannelSelect, voiceChannels, currentVoiceChannel);
  renderChannelPanels();
  renderParticipants();
  renderOnlineParticipants();
  renderAdminChannelsList();
}

function renderChannelPanels() {
  if (textChannelsList) {
    textChannelsList.innerHTML = "";
    for (const ch of textChannels) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      const isCurrent = !textDetached && ch.id === currentTextChannel;
      btn.className = "channel-btn" + (isCurrent && joinedRoom ? " active" : "");
      btn.textContent = ch.name;
      btn.addEventListener("click", () => {
        if (joinedRoom && ch.id === currentTextChannel && !textDetached) {
          textDetached = true;
          setChatEnabled(false);
          if (chatLog) {
            chatLog.innerHTML = "";
          }
          setStatus("Вы вышли из текстового канала (голос остаётся).");
          renderChannelPanels();
          return;
        }
        textDetached = false;
        currentTextChannel = ch.id;
        if (!joinedRoom) {
          void join({ fromAutoRejoin: true });
          return;
        }
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "set-text-channel", channelId: ch.id }));
          if (chatLog) chatLog.innerHTML = "";
        }
        setChatEnabled(true);
        renderChannelPanels();
      });
      li.appendChild(btn);
      textChannelsList.appendChild(li);
    }
  }
  if (voiceChannelsList) {
    voiceChannelsList.innerHTML = "";
    for (const ch of voiceChannels) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      const isCurrent = ch.id === currentVoiceChannel;
      btn.className = "channel-btn" + (isCurrent && joinedRoom ? " active" : "");
      btn.textContent = ch.name;
      btn.addEventListener("click", () => {
        if (joinedRoom && ch.id === currentVoiceChannel) {
          currentVoiceChannel = ch.id;
          void leaveRoom();
          return;
        }
        currentVoiceChannel = ch.id;
        if (!joinedRoom) {
          // Вход через голос не должен автоматически открывать текст.
          textDetached = true;
        }
        if (!joinedRoom) {
          void join({ fromAutoRejoin: true });
          return;
        }
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "set-voice-channel", channelId: ch.id }));
        }
        renderChannelPanels();
      });
      li.appendChild(btn);
      const members = Array.isArray(voiceMembersByChannel[ch.id]) ? voiceMembersByChannel[ch.id] : [];
      if (members.length > 0) {
        const info = document.createElement("div");
        info.className = "voice-members-preview";
        info.textContent = members.join(", ");
        li.appendChild(info);
      }
      voiceChannelsList.appendChild(li);
    }
  }
}

function requestRename(newName) {
  if (!joinedRoom || !socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.resolve(false);
  }
  if (pendingRename) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!pendingRename) {
        return;
      }
      pendingRename = null;
      setStatus("Не удалось изменить имя (таймаут).");
      resolve(false);
    }, 5000);
    pendingRename = { resolve, timer, newName };
    try {
      socket.send(JSON.stringify({ type: "rename", nickname: newName }));
    } catch (_) {
      clearTimeout(timer);
      pendingRename = null;
      resolve(false);
    }
  });
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
  if (textDetached) {
    setStatus("Вы вне текстового канала. Выберите текстовый канал.");
    return;
  }
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
  if (micToggleBottom) {
    micToggleBottom.textContent = micEnabled ? "Микро: вкл" : "Микро: выкл";
  }
  updateDockIcons();
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
  if (myNickname) {
    voiceMicByNickname[myNickname] = enabled;
  }
  publishMicState();
  setMicButtonState();
  renderParticipants();
}

function publishMicState() {
  if (!joinedRoom || !socket || socket.readyState !== WebSocket.OPEN || !myNickname) {
    return;
  }
  try {
    socket.send(JSON.stringify({ type: "set-mic", enabled: micEnabled }));
  } catch (_) {}
}

function ensureAudibleDefaultsAfterJoin() {
  allSoundEnabled = true;
  if (allSoundToggleBtn) {
    allSoundToggleBtn.textContent = "Звук всех: вкл";
  }
  for (const peerNickname of peers.keys()) {
    hearByPeer.set(peerNickname, true);
    applyPeerGain(peerNickname);
    const a = remoteAudioByPeer.get(peerNickname);
    if (a && !peerAudioGraphs.has(peerNickname)) {
      a.muted = false;
      a.volume = Math.min(1, (volumePercentByPeer.get(peerNickname) ?? 100) / 100);
    }
  }
  updateDockIcons();
}

function updateDockIcons() {
  if (micDockBtn) {
    micDockBtn.textContent = "🎙️";
    micDockBtn.classList.toggle("is-off", !micEnabled);
  }
  if (soundDockBtn) {
    soundDockBtn.textContent = "🎧";
    soundDockBtn.classList.toggle("is-off", !allSoundEnabled);
  }
}

function applyPeerMutedState(peerNickname, isMuted) {
  hearByPeer.set(peerNickname, !isMuted);
  applyPeerGain(peerNickname);
  const a = remoteAudioByPeer.get(peerNickname);
  if (a) {
    a.muted = isMuted;
  }
}

function applyAllMutedState(isMuted) {
  allSoundEnabled = !isMuted;
  for (const p of peers.keys()) {
    applyPeerMutedState(p, isMuted);
  }
}

function closeMiniPopup() {
  if (miniPopup) {
    miniPopup.hidden = true;
    miniPopup.innerHTML = "";
  }
}

async function openAudioPopup(anchorEl, peerNickname = "") {
  if (!miniPopup || !anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const current = peerNickname ? getPeerVolumePercent(peerNickname) : allSoundPercent;
  const muted = peerNickname ? hearByPeer.get(peerNickname) === false : !allSoundEnabled;
  miniPopup.innerHTML = `
    <div><strong>${peerNickname ? peerNickname : "Аудио"}</strong></div>
    <label>Громкость</label>
    <input id="miniOutVol" type="range" min="0" max="200" value="${current}" />
    <button id="miniMuteBtn" type="button" class="mini-mute-btn ${muted ? "is-muted" : ""}">
      ${muted ? "Включить звук" : "Мут"}
    </button>
  `;
  miniPopup.style.left = `${Math.max(8, rect.left)}px`;
  miniPopup.style.top = `${Math.max(8, rect.top - 140)}px`;
  miniPopup.hidden = false;
  miniPopup.addEventListener("click", (ev) => ev.stopPropagation(), { once: true });
  const outVol = miniPopup.querySelector("#miniOutVol");
  const miniMuteBtn = miniPopup.querySelector("#miniMuteBtn");
  if (outVol) {
    outVol.addEventListener("input", () => {
      const v = Math.max(0, Math.min(200, Number(outVol.value) || 0));
      if (peerNickname) {
        volumePercentByPeer.set(peerNickname, v);
        applyPeerGain(peerNickname);
        const a = remoteAudioByPeer.get(peerNickname);
        if (a) {
          a.volume = Math.min(1, v / 100);
        }
        persistPeerAudioSettings();
      } else {
        allSoundPercent = v;
        for (const p of peers.keys()) {
          volumePercentByPeer.set(p, v);
          applyPeerGain(p);
          const a = remoteAudioByPeer.get(p);
          if (a) {
            a.volume = Math.min(1, v / 100);
          }
        }
      }
    });
  }
  if (miniMuteBtn) {
    miniMuteBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const nowMuted = miniMuteBtn.classList.toggle("is-muted");
      miniMuteBtn.textContent = nowMuted ? "Включить звук" : "Мут";
      if (peerNickname) {
        applyPeerMutedState(peerNickname, nowMuted);
        persistPeerAudioSettings();
      } else {
        applyAllMutedState(nowMuted);
      }
      renderParticipants();
      updateDockIcons();
    });
  }
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
  const peerSet = new Set(Array.from(peers.keys()));
  if (joinedRoom) {
    const serverList = Array.isArray(voiceMembersByChannel[currentVoiceChannel])
      ? voiceMembersByChannel[currentVoiceChannel]
      : [];
    for (const n of serverList) {
      if (n) {
        peerSet.add(n);
      }
    }
  } else {
    for (const list of Object.values(voiceMembersByChannel)) {
      if (!Array.isArray(list)) {
        continue;
      }
      for (const n of list) {
        if (n) {
          peerSet.add(n);
        }
      }
    }
  }
  for (const peerNickname of Array.from(peerSet).sort((a, b) => a.localeCompare(b, "ru"))) {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "peer-row";
    const nameWrap = document.createElement("span");
    nameWrap.className = "peer-name-wrap";
    const nameSpan = document.createElement("span");
    const isMuted = hearByPeer.get(peerNickname) === false;
    const peerMicEnabled = voiceMicByNickname[peerNickname] !== false;
    nameSpan.className = "peer-name" + (isMuted ? " muted-label" : "");
    nameSpan.textContent = peerNickname;
    nameWrap.appendChild(nameSpan);
    if (!peerMicEnabled) {
      const micBadge = document.createElement("span");
      micBadge.className = "peer-mic-badge is-off";
      micBadge.textContent = "🎙️";
      micBadge.setAttribute("title", "Микрофон выключен");
      micBadge.setAttribute("aria-label", "Микрофон выключен");
      nameWrap.appendChild(micBadge);
    }
    row.appendChild(nameWrap);
    const isSelf = myNickname && peerNickname === myNickname;
    if (!isSelf) {
      const audioBtn = document.createElement("button");
      audioBtn.type = "button";
      audioBtn.className = "peer-audio-btn";
      audioBtn.textContent = isMuted ? "🔇" : "🔊";
      audioBtn.classList.toggle("is-muted", isMuted);
      audioBtn.setAttribute("aria-label", isMuted ? `Включить звук ${peerNickname}` : `Настройки звука ${peerNickname}`);
      audioBtn.setAttribute("title", isMuted ? "Пользователь заглушён" : "Настройки звука");
      audioBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        await openAudioPopup(audioBtn, peerNickname);
      });
      row.appendChild(audioBtn);
    }
    li.appendChild(row);
    if (!isSelf) {
      li.title = "Нажмите: громкость / mute";
      li.style.cursor = "pointer";
      li.addEventListener("click", async () => {
        await openAudioPopup(li, peerNickname);
      });
    } else {
      li.title = "";
      li.style.cursor = "default";
    }

    participantsEl.appendChild(li);
  }

  syncAdminParticipantListIfVisible();
}

function renderOnlineParticipants() {
  if (!onlineParticipantsEl) {
    return;
  }
  onlineParticipantsEl.innerHTML = "";
  for (const nickname of onlineUsersList()) {
    const li = document.createElement("li");
    const nameWrap = document.createElement("span");
    nameWrap.className = "peer-name-wrap";
    const nameSpan = document.createElement("span");
    nameSpan.className = "peer-name";
    nameSpan.textContent = nickname;
    nameWrap.appendChild(nameSpan);
    if (voiceMicByNickname[nickname] === false) {
      const micBadge = document.createElement("span");
      micBadge.className = "peer-mic-badge is-off";
      micBadge.textContent = "🎙️";
      micBadge.setAttribute("title", "Микрофон выключен");
      micBadge.setAttribute("aria-label", "Микрофон выключен");
      nameWrap.appendChild(micBadge);
    }
    li.appendChild(nameWrap);
    onlineParticipantsEl.appendChild(li);
  }
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
  renderAdminChannelsList();
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

function renderAdminChannelsList() {
  if (!adminChannelsList) {
    return;
  }
  adminChannelsList.innerHTML = "";
  if (!cachedAdminSecret) {
    return;
  }
  const rows = [
    ...textChannels.map((ch) => ({ kind: "text", ch })),
    ...voiceChannels.map((ch) => ({ kind: "voice", ch })),
  ];
  if (rows.length === 0) {
    const li = document.createElement("li");
    li.className = "admin-participant-hint";
    li.textContent = "Каналы не найдены.";
    adminChannelsList.appendChild(li);
    return;
  }
  for (const row of rows) {
    const li = document.createElement("li");
    li.className = "admin-channel-row";
    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "admin-channel-name";
    name.textContent = row.ch.name;
    const meta = document.createElement("div");
    meta.className = "admin-channel-meta";
    meta.textContent = row.kind === "voice" ? "голос" : "текст";
    left.appendChild(name);
    left.appendChild(meta);
    const actions = document.createElement("div");
    actions.className = "admin-channel-actions";
    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "btn-channel-action";
    renameBtn.textContent = "Переименовать";
    renameBtn.addEventListener("click", () => {
      const nextName = (prompt("Новое имя канала:", row.ch.name) || "").trim();
      if (!nextName) {
        return;
      }
      sendAdminChannelOp("admin-channel-rename", row.kind, row.ch.id, nextName);
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-channel-action btn-channel-action-danger";
    deleteBtn.textContent = "Удалить";
    deleteBtn.disabled = row.ch.id === "text-general" || row.ch.id === "voice-general";
    deleteBtn.addEventListener("click", () => {
      if (deleteBtn.disabled) {
        return;
      }
      if (!confirm(`Удалить канал "${row.ch.name}"?`)) {
        return;
      }
      sendAdminChannelOp("admin-channel-delete", row.kind, row.ch.id, "");
    });
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    li.appendChild(left);
    li.appendChild(actions);
    adminChannelsList.appendChild(li);
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

function sendAdminChannelOp(type, kind, id, name) {
  if (!cachedAdminSecret || !socket || socket.readyState !== WebSocket.OPEN || !joinedRoom) {
    return;
  }
  const payload = { type, kind, id, name, secret: cachedAdminSecret };
  socket.send(JSON.stringify(payload));
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
  } else {
    try {
      pc.addTransceiver("audio", { direction: "recvonly" });
    } catch (_) {}
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
    try {
      socket.send(JSON.stringify({ type: "get-channels" }));
    } catch (_) {}
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
        textChannel: currentTextChannel,
        voiceChannel: currentVoiceChannel,
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
        nicknameInput.value = message.nickname;
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
          if (micToggleBottom) {
            micToggleBottom.disabled = false;
          }
          setChatEnabled(!textDetached);
          syncAuthUi();
          ensureAudibleDefaultsAfterJoin();
          publishMicState();
          // Сразу обновляем список участников после входа:
          // он должен быть виден даже до установки p2p-соединений.
          renderParticipants();
          for (const peerNickname of message.peers) {
            await createPeerConnection(peerNickname, shouldInitiateWithPeer(peerNickname));
          }
        });
        await rtcChain;
        updateAdminJoinHint();
        break;
      case "chat-history":
        renderChatHistory(message.messages || []);
        break;
      case "chat-message":
        if (textDetached) {
          break;
        }
        if (message.channelId && message.channelId !== currentTextChannel) {
          break;
        }
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
        if (textDetached) {
          break;
        }
        if (message.channelId && message.channelId !== currentTextChannel) {
          break;
        }
        applyChatMessageUpdated(message);
        break;
      case "chat-message-reactions":
        if (textDetached) {
          break;
        }
        if (message.channelId && message.channelId !== currentTextChannel) {
          break;
        }
        applyChatMessageReactions(message);
        break;
      case "chat-message-deleted":
        if (textDetached) {
          break;
        }
        if (message.channelId && message.channelId !== currentTextChannel) {
          break;
        }
        applyChatMessageDeleted(message.id);
        break;
      case "channels-state":
        applyChannelsState(message);
        if (Array.isArray(message.voicePeers)) {
          for (const peerNickname of Array.from(peers.keys())) {
            if (!message.voicePeers.includes(peerNickname)) {
              removePeer(peerNickname);
            }
          }
          enqueueRtc(async () => {
            for (const peerNickname of message.voicePeers) {
              if (!peers.has(peerNickname)) {
                await createPeerConnection(peerNickname, shouldInitiateWithPeer(peerNickname));
              }
            }
          });
          await rtcChain;
        }
        break;
      case "join-rejected":
        joinedRoom = false;
        setStatus(`Вход отклонён: ${message.reason}`);
        setChatEnabled(false);
        clearRejoinHint();
        syncAuthUi();
        updateAdminJoinHint();
        break;
      case "peer-joined":
        enqueueRtc(async () => {
          await createPeerConnection(message.nickname, shouldInitiateWithPeer(message.nickname));
          setStatus(`${message.nickname} вошёл`);
        });
        await rtcChain;
        notifyAdminRosterRefresh();
        break;
      case "peer-left":
        removePeer(message.nickname);
        if (message && typeof message.nickname === "string") {
          delete voiceMicByNickname[message.nickname];
        }
        renderOnlineParticipants();
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
      case "mic-state":
        if (message && typeof message.nickname === "string") {
          voiceMicByNickname[message.nickname] = message.enabled !== false;
          renderParticipants();
          renderOnlineParticipants();
        }
        break;
      case "rename-ok": {
        const oldNickname = String(message.oldNickname || myNickname || "");
        const nextNickname = String(message.nickname || "").trim();
        if (nextNickname) {
          if (oldNickname && Object.prototype.hasOwnProperty.call(voiceMicByNickname, oldNickname)) {
            delete voiceMicByNickname[oldNickname];
          }
          voiceMicByNickname[nextNickname] = micEnabled;
          myNickname = nextNickname;
          if (nicknameInput) {
            nicknameInput.value = nextNickname;
          }
          sessionStorage.setItem(SS_NICK, nextNickname);
          setCookie(NICK_COOKIE, nextNickname, NICK_COOKIE_MAX_AGE);
          setStatus(`Имя изменено: ${oldNickname} -> ${nextNickname}`);
          renderChannelPanels();
          renderParticipants();
          renderOnlineParticipants();
        }
        if (pendingRename) {
          clearTimeout(pendingRename.timer);
          pendingRename.resolve(true);
          pendingRename = null;
        }
        break;
      }
      case "rename-rejected": {
        const reason = message.reason || "Имя занято.";
        setStatus(`Имя не изменено: ${reason}`);
        if (pendingRename) {
          clearTimeout(pendingRename.timer);
          pendingRename.resolve(false);
          pendingRename = null;
        }
        break;
      }
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
      if (micToggleBottom) {
        micToggleBottom.disabled = true;
      }
      setChatEnabled(false);
      syncAuthUi();
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

function requestChannelsSnapshot() {
  let received = false;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${protocol}://${location.host}`;
  const tmp = new WebSocket(wsUrl);
  tmp.onopen = () => {
    try {
      tmp.send(JSON.stringify({ type: "get-channels" }));
    } catch (_) {}
  };
  tmp.onmessage = (event) => {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch (_) {}
    if (message && message.type === "channels-state") {
      received = true;
      applyChannelsState(message);
      try {
        tmp.close();
      } catch (_) {}
    }
  };
  tmp.onclose = () => {
    if (!received && !joinedRoom) {
      setTimeout(() => {
        requestChannelsSnapshot();
      }, 900);
    }
  };
  tmp.onerror = () => {
    try {
      tmp.close();
    } catch (_) {}
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
    renderAdminChannelsList();
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
    if (!joinedRoom) {
      setStatus("Сначала войдите в чат.");
      return;
    }
    setChatMenuOpen(chatDropdown.hidden);
  });
}

document.addEventListener("click", () => {
  closeChatMenu();
  closeAllChatMessageMenus();
  closeAllReactionPickers();
  closeMiniPopup();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") {
    return;
  }
  closeChatMenu();
  closeAllChatMessageMenus();
  closeAllReactionPickers();
  closeAdminModal();
  closeSimpleModal(profileModal);
  closeSimpleModal(channelsModal);
  closeSimpleModal(donateModal);
  closeMiniPopup();
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

if (menuProfileBtn) {
  menuProfileBtn.addEventListener("click", () => {
    if (profileNameInput) {
      profileNameInput.value =
        (myNickname && String(myNickname).trim()) ||
        (nicknameInput && nicknameInput.value ? nicknameInput.value.trim() : "") ||
        getCookie(NICK_COOKIE) ||
        "";
    }
    openSimpleModal(profileModal);
    closeChatMenu();
  });
}

if (menuDonateBtn) {
  menuDonateBtn.addEventListener("click", () => {
    openSimpleModal(donateModal);
    closeChatMenu();
  });
}

if (profileCloseBtn) {
  profileCloseBtn.addEventListener("click", () => closeSimpleModal(profileModal));
}
if (profileSaveBtn) {
  profileSaveBtn.addEventListener("click", async () => {
    const newName = String(profileNameInput ? profileNameInput.value : "").trim();
    if (!newName) {
      setStatus("Введите имя.");
      return;
    }
    const oldName = String(myNickname || "").trim();
    if (newName === oldName) {
      closeSimpleModal(profileModal);
      return;
    }
    if (joinedRoom) {
      const ok = await requestRename(newName);
      if (!ok) {
        return;
      }
      closeSimpleModal(profileModal);
      return;
    }
    if (nicknameInput) {
      nicknameInput.value = newName;
    }
    myNickname = newName;
    sessionStorage.setItem(SS_NICK, newName);
    setCookie(NICK_COOKIE, newName, NICK_COOKIE_MAX_AGE);
    closeSimpleModal(profileModal);
    await join({ fromAutoRejoin: false });
  });
}
if (channelsCloseBtn) {
  channelsCloseBtn.addEventListener("click", () => closeSimpleModal(channelsModal));
}
if (donateCloseBtn) {
  donateCloseBtn.addEventListener("click", () => closeSimpleModal(donateModal));
}
if (textChannelSelect) {
  textChannelSelect.addEventListener("change", () => {
    const channelId = textChannelSelect.value;
    currentTextChannel = channelId;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "set-text-channel", channelId }));
      if (chatLog) {
        chatLog.innerHTML = "";
      }
    }
  });
}
if (voiceChannelSelect) {
  voiceChannelSelect.addEventListener("change", () => {
    const channelId = voiceChannelSelect.value;
    currentVoiceChannel = channelId;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "set-voice-channel", channelId }));
    }
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

if (adminCreateTextChannelBtn) {
  adminCreateTextChannelBtn.addEventListener("click", () => {
    const id = (prompt("ID текстового канала (латиница/цифры):", "text-") || "").trim();
    const name = (prompt("Название текстового канала (кириллица можно):", "") || "").trim();
    if (id && name) {
      sendAdminChannelOp("admin-channel-create", "text", id, name);
    }
  });
}
if (adminCreateVoiceChannelBtn) {
  adminCreateVoiceChannelBtn.addEventListener("click", () => {
    const id = (prompt("ID голосового канала (латиница/цифры):", "voice-") || "").trim();
    const name = (prompt("Название голосового канала (кириллица можно):", "") || "").trim();
    if (id && name) {
      sendAdminChannelOp("admin-channel-create", "voice", id, name);
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

for (const m of [profileModal, channelsModal, donateModal]) {
  if (!m) {
    continue;
  }
  m.addEventListener("click", (e) => {
    if (e.target === m) {
      closeSimpleModal(m);
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

  await loadRtcConfig();

  if (!window.isSecureContext) {
    const httpsPort = document.body.dataset.httpsPort || "3443";
    const host = location.hostname;
    const httpsHint =
      host === "localhost" || host === "127.0.0.1"
        ? " На localhost HTTP допустим, иначе https://localhost:" + httpsPort + "/"
        : ` Откройте https://${host}:${httpsPort}/ и примите сертификат.`;
    setStatus("Микрофон отключён: нужен HTTPS/localhost." + httpsHint + " Текстовый чат доступен.");
  }

  forceDisconnectClient();
  myNickname = nickname;
  joinBtn.disabled = false;
  nicknameInput.disabled = false;

  try {
    if (window.isSecureContext) {
      await resumeAudioContextIfNeeded();
      localStream = await navigator.mediaDevices.getUserMedia(getAudioConstraints());
      setMicEnabled(localStorage.getItem(LS_MIC_ENABLED) !== "0");
    } else {
      localStream = null;
      setMicEnabled(false);
    }
    connectSocket();
  } catch (error) {
    console.error(error);
    localStream = null;
    setMicEnabled(false);
    if (error && error.name === "NotAllowedError") {
      setStatus("Микрофон запрещён. Подключаю только текстовый чат.");
    } else if (error && error.name === "NotFoundError") {
      setStatus("Микрофон не найден. Подключаю только текстовый чат.");
    } else {
      setStatus(`Микрофон недоступен (${error?.name || "ошибка"}). Подключаю только текстовый чат.`);
    }
    connectSocket();
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
    void leaveRoom();
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
if (micDockBtn) {
  micDockBtn.addEventListener("click", () => toggleMicFromUi());
  micDockBtn.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await openAudioPopup(micDockBtn);
  });
}
if (soundDockBtn) {
  soundDockBtn.addEventListener("click", () => {
    allSoundEnabled = !allSoundEnabled;
    // При выключении наушников выключаем и микрофон.
    // Обратного автovключения микрофона не делаем.
    if (!allSoundEnabled) {
      setMicEnabled(false);
    }
    for (const peerNickname of peers.keys()) {
      hearByPeer.set(peerNickname, allSoundEnabled);
      applyPeerGain(peerNickname);
    }
    renderParticipants();
    updateDockIcons();
  });
  soundDockBtn.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await openAudioPopup(soundDockBtn);
  });
}
if (micToggleBottom) {
  micToggleBottom.addEventListener("click", () => {
    toggleMicFromUi();
  });
}
if (allSoundToggleBtn) {
  allSoundToggleBtn.addEventListener("click", () => {
    allSoundEnabled = !allSoundEnabled;
    allSoundToggleBtn.textContent = allSoundEnabled ? "Звук всех: вкл" : "Звук всех: выкл";
    for (const peerNickname of peers.keys()) {
      hearByPeer.set(peerNickname, allSoundEnabled);
      applyPeerGain(peerNickname);
    }
    persistPeerAudioSettings();
    renderParticipants();
  });
}
if (allSoundVolume) {
  allSoundVolume.addEventListener("input", () => {
    allSoundPercent = Math.max(0, Math.min(200, Number(allSoundVolume.value) || 0));
    if (allSoundVolumeVal) {
      allSoundVolumeVal.textContent = `${allSoundPercent}%`;
    }
    for (const peerNickname of peers.keys()) {
      volumePercentByPeer.set(peerNickname, allSoundPercent);
      applyPeerGain(peerNickname);
    }
    persistPeerAudioSettings();
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
  try {
    const raw = localStorage.getItem(LS_CHANNELS_CACHE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.textChannels) && parsed.textChannels.length > 0) {
        textChannels = parsed.textChannels;
      }
      if (Array.isArray(parsed?.voiceChannels) && parsed.voiceChannels.length > 0) {
        voiceChannels = parsed.voiceChannels;
      }
    }
  } catch (_) {}
  const c = getCookie(NICK_COOKIE);
  if (nicknameInput && c && !nicknameInput.value.trim()) {
    nicknameInput.value = c;
  }
  renderChannelPanels();
  syncAuthUi();
  requestChannelsSnapshot();
  if (c && !joinedRoom) {
    setTimeout(() => {
      void join({ fromAutoRejoin: true });
    }, 0);
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
