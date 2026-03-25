const NICK_COOKIE = "zalupa228_nick";
const NICK_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
const SS_JOINED = "zalupa_vc_joined";
const SS_NICK = "zalupa_vc_nick";
const LS_THEME = "zalupa_theme";
const LS_PEER_AUDIO = "zalupa228_peer_audio";
const LS_MIC_ENABLED = "zalupa228_mic_on";

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
  micBtn.disabled = true;
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
const statusEl = document.getElementById("status");
const participantsEl = document.getElementById("participants");
const chatLog = document.getElementById("chatLog");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatImageInput = document.getElementById("chatImageInput");
const chatImageBtn = document.getElementById("chatImageBtn");
const themeBtn = document.getElementById("themeBtn");

const peers = new Map();
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
let rtcChain = Promise.resolve();

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

function appendChatMessage({ nickname, text, createdAt, imageMime, imageData }) {
  if (!chatLog) {
    return;
  }
  const line = document.createElement("div");
  line.className = "chat-line";
  const meta = document.createElement("div");
  meta.className = "chat-meta";
  meta.textContent = `${nickname} · ${formatChatTime(createdAt)}`;
  const body = document.createElement("div");
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
  line.appendChild(meta);
  line.appendChild(body);
  chatLog.appendChild(line);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderChatHistory(messages) {
  if (!chatLog) {
    return;
  }
  chatLog.innerHTML = "";
  for (const m of messages) {
    appendChatMessage({
      nickname: m.nickname,
      text: m.text,
      createdAt: m.createdAt,
      imageMime: m.imageMime,
      imageData: m.imageData,
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
      if (t.startsWith("image/")) {
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
  if (cd.files && cd.files.length) {
    for (let i = 0; i < cd.files.length; i++) {
      const f = cd.files[i];
      const t = String(f.type || "");
      if (t.startsWith("image/")) {
        return f;
      }
    }
    const f0 = cd.files[0];
    if (f0) {
      const t0 = String(f0.type || "");
      if (!t0 || t0 === "application/octet-stream") {
        return f0;
      }
    }
  }
  if (cd.items) {
    for (const item of cd.items) {
      if (item.kind !== "file") {
        continue;
      }
      const ty = String(item.type || "");
      if (ty.startsWith("image/") || ty === "") {
        const file = item.getAsFile();
        if (file && file.size > 0) {
          return file;
        }
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
  micBtn.textContent = `Мик: ${micEnabled ? "вкл" : "выкл"}`;
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
      case "join-accepted":
        joinBtn.disabled = true;
        nicknameInput.disabled = true;
        nicknameInput.value = message.nickname;
        if (leaveBtn) {
          leaveBtn.disabled = false;
        }
        enqueueRtc(async () => {
          joinedRoom = true;
          myNickname = message.nickname;
          setCookie(NICK_COOKIE, myNickname || message.nickname, NICK_COOKIE_MAX_AGE);
          sessionStorage.setItem(SS_JOINED, "1");
          sessionStorage.setItem(SS_NICK, message.nickname);
          setStatus(`В сети как ${message.nickname}`);
          micBtn.disabled = false;
          setChatEnabled(true);
          for (const peerNickname of message.peers) {
            await createPeerConnection(peerNickname, false);
          }
        });
        await rtcChain;
        break;
      case "chat-history":
        renderChatHistory(message.messages || []);
        break;
      case "chat-message":
        appendChatMessage({
          nickname: message.nickname,
          text: message.text,
          createdAt: message.createdAt,
          imageMime: message.imageMime,
          imageData: message.imageData,
        });
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
        break;
      case "peer-joined":
        enqueueRtc(async () => {
          await createPeerConnection(message.nickname, true);
          setStatus(`${message.nickname} вошёл`);
        });
        await rtcChain;
        break;
      case "peer-left":
        removePeer(message.nickname);
        setStatus(`${message.nickname} вышел`);
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
        setStatus(`Ошибка: ${message.message}`);
        break;
      default:
        break;
    }
  };

  socket.onclose = () => {
    try {
      joinedRoom = false;
      socket = null;
      rtcChain = Promise.resolve();
      setStatus("Отключено");
      micBtn.disabled = true;
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
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  themeBtn.textContent = isLight ? "Тема: светлая" : "Тема: тёмная";
  themeBtn.setAttribute("aria-pressed", isLight ? "false" : "true");
}

themeBtn.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(LS_THEME, next);
  updateThemeButtonLabel();
});

updateThemeButtonLabel();

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

micBtn.addEventListener("click", () => {
  setMicEnabled(!micEnabled);
});

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

document.addEventListener("paste", onDocumentPasteForChat, true);

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
