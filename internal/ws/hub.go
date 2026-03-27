package ws

import (
	"context"
	"encoding/json"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"

	"zalupa228local/internal/chatstore"
)

type client struct {
	ws          *websocket.Conn
	nickname    string
	textChannel string
	voiceChannel string
}

type connWriter struct {
	conn *websocket.Conn
	ch   chan []byte
	done chan struct{}
}

func newConnWriter(conn *websocket.Conn) *connWriter {
	w := &connWriter{
		conn: conn,
		ch:   make(chan []byte, 64),
		done: make(chan struct{}),
	}
	go func() {
		defer close(w.done)
		for b := range w.ch {
			_ = conn.WriteMessage(websocket.TextMessage, b)
		}
	}()
	return w
}

func (w *connWriter) send(b []byte) {
	select {
	case w.ch <- b:
	default:
		// drop if client is too slow; keep server responsive
	}
}

func (w *connWriter) close() {
	close(w.ch)
	<-w.done
}

type hubState struct {
	mu sync.Mutex

	clientsByConn   map[*websocket.Conn]*client
	connsByNickname map[string]*websocket.Conn
	writersByConn   map[*websocket.Conn]*connWriter
	adminByConn     map[*websocket.Conn]bool

	textChannels  map[string]ChatChannel
	voiceChannels map[string]ChatChannel
}

func (h *Hub) getState() *hubState {
	h.stateOnce.Do(func() {
		h.state = &hubState{
			clientsByConn:   make(map[*websocket.Conn]*client),
			connsByNickname: make(map[string]*websocket.Conn),
			writersByConn:   make(map[*websocket.Conn]*connWriter),
			adminByConn:     make(map[*websocket.Conn]bool),
			textChannels: map[string]ChatChannel{
				"text-general": {ID: "text-general", Name: "Общий текст"},
			},
			voiceChannels: map[string]ChatChannel{
				"voice-general": {ID: "voice-general", Name: "Общий голос"},
			},
		}
	})
	return h.state
}

func (h *Hub) handleConn(ctx context.Context, c *websocket.Conn) {
	defer func() { _ = c.Close() }()

	c.SetReadLimit(8 << 20)
	_ = c.SetReadDeadline(time.Time{})

	st := h.getState()
	st.mu.Lock()
	if _, ok := st.writersByConn[c]; !ok {
		st.writersByConn[c] = newConnWriter(c)
	}
	st.mu.Unlock()

	h.send(c, HelloPayload{Type: "hello", AdminPanel: true, ChatMessageOps: true, ServerLogs: h.serverLogsEnabled()})
	h.sendServerLogHistory(c)
	h.onGetChannels(c)

	for {
		_, raw, err := c.ReadMessage()
		if err != nil {
			h.emitServerLog("info", "ws.disconnect", "WebSocket disconnected.", "", nil)
			h.leave(c)
			return
		}

		var msg map[string]any
		if err := json.Unmarshal(raw, &msg); err != nil {
			h.emitServerLog("warn", "ws.bad_json", "Invalid JSON payload from client.", "", map[string]string{"error": err.Error()})
			h.sendMap(c, map[string]any{"type": "error", "message": "Invalid JSON payload."})
			continue
		}
		if msg == nil {
			h.emitServerLog("warn", "ws.bad_shape", "Invalid WebSocket message shape.", "", nil)
			h.sendMap(c, map[string]any{"type": "error", "message": "Invalid message shape."})
			continue
		}

		msgType := normalizeWsMessageType(msg["type"])
		if msgType == "" {
			log.Printf("WebSocket message without type: %v", msg)
			h.emitServerLog("warn", "ws.missing_type", "WebSocket message without type.", "", nil)
			continue
		}

		if clientShouldNotSend(msgType) {
			continue
		}

		switch msgType {
		case "get-channels":
			h.onGetChannels(c)
		case "join":
			h.onJoin(c, msg)
		default:
			sender := h.getSender(c)
			if sender == nil {
				h.sendMap(c, map[string]any{"type": "error", "message": "Join before signaling."})
				continue
			}
			switch msgType {
			case "set-text-channel":
				h.onSetTextChannel(c, sender, msg)
			case "set-voice-channel":
				h.onSetVoiceChannel(c, sender, msg)
			case "signal":
				h.onSignal(c, sender, msg)
			case "chat":
				h.onChat(c, sender, msg)
			case "chat-edit":
				h.onChatEdit(c, sender, msg)
			case "chat-delete":
				h.onChatDelete(c, sender, msg)
			case "chat-react":
				h.onChatReact(c, sender, msg)
			case "admin-verify":
				h.onAdminVerify(c, msg)
			case "admin-peers":
				h.onAdminPeers(c, msg)
			case "admin-kick":
				h.onAdminKick(c, sender, msg)
			case "admin-channel-create":
				h.onAdminChannelCreate(c, msg)
			case "admin-channel-rename":
				h.onAdminChannelRename(c, msg)
			case "admin-channel-delete":
				h.onAdminChannelDelete(c, msg)
			default:
				// chat ops added in mongo-store step
				log.Printf("Unknown WebSocket message type: %s %v", msgType, msg)
				h.emitServerLog("warn", "ws.unknown_type", "Unknown WebSocket message type.", "", map[string]string{"type": msgType})
				h.sendMap(c, map[string]any{"type": "error", "message": "Unknown message type: " + msgType})
			}
		}
	}
}

func clientShouldNotSend(t string) bool {
	switch t {
	case "hello", "chat-history", "chat-message", "join-accepted", "join-rejected",
		"peer-joined", "peer-left", "signal-error", "error", "kicked",
		"admin-verify-ok", "admin-peers-result", "chat-message-updated",
		"chat-message-deleted", "chat-message-reactions", "channels-state":
		return true
	default:
		return false
	}
}

func (h *Hub) onGetChannels(c *websocket.Conn) {
	st := h.getState()
	st.mu.Lock()
	textChannels := channelsSorted(st.textChannels)
	voiceChannels := channelsSorted(st.voiceChannels)
	voiceMembers := voiceMembersByChannelLocked(st)
	st.mu.Unlock()
	h.sendMap(c, map[string]any{
		"type":          "channels-state",
		"textChannels":  textChannels,
		"voiceChannels": voiceChannels,
		"voiceMembers":  voiceMembers,
	})
}

func (h *Hub) onJoin(c *websocket.Conn, msg map[string]any) {
	nickname := strings.TrimSpace(asString(msg["nickname"]))
	if nickname == "" {
		h.emitServerLog("warn", "join.rejected", "Join rejected: nickname is required.", "", nil)
		h.sendMap(c, map[string]any{"type": "join-rejected", "reason": "Nickname is required."})
		return
	}

	st := h.getState()
	st.mu.Lock()
	if _, ok := st.clientsByConn[c]; ok {
		st.mu.Unlock()
		h.emitServerLog("warn", "join.rejected", "Join rejected: connection already joined.", nickname, nil)
		h.sendMap(c, map[string]any{"type": "join-rejected", "reason": "Already joined."})
		return
	}
	if _, ok := st.connsByNickname[nickname]; ok {
		st.mu.Unlock()
		h.emitServerLog("warn", "join.rejected", "Join rejected: nickname already taken.", nickname, nil)
		h.sendMap(c, map[string]any{"type": "join-rejected", "reason": "Nickname already taken."})
		return
	}

	textChannel := strings.TrimSpace(asString(msg["textChannel"]))
	if _, ok := st.textChannels[textChannel]; !ok {
		textChannel = "text-general"
	}
	voiceChannel := strings.TrimSpace(asString(msg["voiceChannel"]))
	if _, ok := st.voiceChannels[voiceChannel]; !ok {
		voiceChannel = "voice-general"
	}

	st.clientsByConn[c] = &client{ws: c, nickname: nickname, textChannel: textChannel, voiceChannel: voiceChannel}
	st.connsByNickname[nickname] = c

	peers := make([]string, 0, len(st.connsByNickname))
	for name, conn := range st.connsByNickname {
		if name != nickname && st.clientsByConn[conn] != nil && st.clientsByConn[conn].voiceChannel == voiceChannel {
			peers = append(peers, name)
		}
	}
	textChannels := channelsSorted(st.textChannels)
	voiceChannels := channelsSorted(st.voiceChannels)
	voicePeers := peersForVoiceChannelLocked(st, voiceChannel, nickname)
	voiceMembers := voiceMembersByChannelLocked(st)
	st.mu.Unlock()

	h.emitServerLog("info", "join.accepted", "Participant joined the room.", nickname, map[string]string{
		"textChannel":  textChannel,
		"voiceChannel": voiceChannel,
	})
	h.sendMap(c, map[string]any{"type": "join-accepted", "nickname": nickname, "peers": peers})
	h.sendMap(c, map[string]any{
		"type":         "channels-state",
		"textChannels": textChannels,
		"voiceChannels": voiceChannels,
		"currentText":  textChannel,
		"currentVoice": voiceChannel,
		"voicePeers":   voicePeers,
		"voiceMembers": voiceMembers,
	})
	h.broadcastToVoiceChannel(map[string]any{"type": "peer-joined", "nickname": nickname}, voiceChannel, c)
	h.broadcastChannelsState()

	go func() {
		msgs, err := h.getStore().History(context.Background(), 100)
		if err != nil {
			log.Printf("chat-history: %v", err)
			h.emitServerLog("error", "chat.history_failed", "Failed to load chat history.", nickname, map[string]string{"error": err.Error()})
			h.sendMap(c, map[string]any{"type": "error", "message": "Failed to load chat history."})
			return
		}
		h.sendMap(c, map[string]any{"type": "chat-history", "messages": toHistoryPayload(msgs)})
	}()
}

func (h *Hub) onSignal(c *websocket.Conn, sender *client, msg map[string]any) {
	target := strings.TrimSpace(asString(msg["target"]))
	payload := msg["payload"]

	st := h.getState()
	st.mu.Lock()
	targetConn := st.connsByNickname[target]
	targetClient := st.clientsByConn[targetConn]
	st.mu.Unlock()

	if targetConn == nil || targetClient == nil {
		h.emitServerLog("warn", "signal.target_missing", "Signal target not found.", sender.nickname, map[string]string{"target": target})
		h.sendMap(c, map[string]any{
			"type":   "signal-error",
			"target": target,
			"reason": "Target not found.",
		})
		return
	}
	if targetClient.voiceChannel != sender.voiceChannel {
		h.emitServerLog("warn", "signal.wrong_channel", "Signal target is in another voice channel.", sender.nickname, map[string]string{"target": target})
		h.sendMap(c, map[string]any{
			"type":   "signal-error",
			"target": target,
			"reason": "Target in another voice channel.",
		})
		return
	}

	h.sendMap(targetConn, map[string]any{
		"type":    "signal",
		"from":    sender.nickname,
		"payload": payload,
	})
	h.emitServerLog("info", "signal.forwarded", "Signal forwarded to peer.", sender.nickname, map[string]string{"target": target})
}

func (h *Hub) onAdminVerify(c *websocket.Conn, msg map[string]any) {
	if !h.adminPanelSecretOk(msg) {
		h.emitServerLog("warn", "admin.verify_failed", "Admin verification failed.", "", nil)
		h.sendMap(c, map[string]any{"type": "error", "message": "Неверный пароль."})
		return
	}
	st := h.getState()
	st.mu.Lock()
	st.adminByConn[c] = true
	st.mu.Unlock()
	h.emitServerLog("info", "admin.verify_ok", "Admin verification succeeded.", "", nil)
	h.sendMap(c, map[string]any{"type": "admin-verify-ok"})
}

func (h *Hub) onAdminPeers(c *websocket.Conn, msg map[string]any) {
	if !h.isAdminConn(c) {
		h.sendMap(c, map[string]any{"type": "error", "message": "Неверный пароль админ-панели."})
		return
	}
	st := h.getState()
	st.mu.Lock()
	roster := make([]string, 0, len(st.connsByNickname))
	for name := range st.connsByNickname {
		roster = append(roster, name)
	}
	st.mu.Unlock()

	coll := collate.New(language.Russian)
	sort.Slice(roster, func(i, j int) bool {
		return coll.CompareString(roster[i], roster[j]) < 0
	})

	h.sendMap(c, map[string]any{"type": "admin-peers-result", "peers": roster})
}

func (h *Hub) onAdminKick(c *websocket.Conn, sender *client, msg map[string]any) {
	if !h.isAdminConn(c) {
		h.sendMap(c, map[string]any{"type": "error", "message": "Неверный пароль админ-панели."})
		return
	}
	targetNick := strings.TrimSpace(asString(msg["target"]))
	if targetNick == "" {
		h.sendMap(c, map[string]any{"type": "error", "message": "Укажите ник участника."})
		return
	}

	st := h.getState()
	st.mu.Lock()
	targetConn := st.connsByNickname[targetNick]
	st.mu.Unlock()

	if targetConn == nil {
		h.emitServerLog("warn", "admin.kick_missing", "Admin kick target not found.", sender.nickname, map[string]string{"target": targetNick})
		h.sendMap(c, map[string]any{"type": "error", "message": "Участник не в комнате."})
		return
	}
	h.emitServerLog("warn", "admin.kick", "Participant was kicked by admin.", sender.nickname, map[string]string{"target": targetNick})

	h.sendMap(targetConn, map[string]any{
		"type":   "kicked",
		"reason": "Вас исключили из комнаты (оператор: " + sender.nickname + ").",
	})

	h.leave(targetConn)
	_ = targetConn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(4000, "kicked"), time.Now().Add(2*time.Second))
	_ = targetConn.Close()
}

func (h *Hub) onSetTextChannel(c *websocket.Conn, sender *client, msg map[string]any) {
	channelID := strings.TrimSpace(asString(msg["channelId"]))
	st := h.getState()
	st.mu.Lock()
	if _, ok := st.textChannels[channelID]; !ok {
		st.mu.Unlock()
		h.emitServerLog("warn", "channel.text_missing", "Text channel not found.", sender.nickname, map[string]string{"channelId": channelID})
		h.sendMap(c, map[string]any{"type": "error", "message": "Текстовый канал не найден."})
		return
	}
	sender.textChannel = channelID
	textChannels := channelsSorted(st.textChannels)
	voiceChannels := channelsSorted(st.voiceChannels)
	voicePeers := peersForVoiceChannelLocked(st, sender.voiceChannel, sender.nickname)
	voiceMembers := voiceMembersByChannelLocked(st)
	st.mu.Unlock()
	h.emitServerLog("info", "channel.text_set", "Participant switched text channel.", sender.nickname, map[string]string{"channelId": channelID})
	h.sendMap(c, map[string]any{
		"type":          "channels-state",
		"textChannels":  textChannels,
		"voiceChannels": voiceChannels,
		"currentText":   sender.textChannel,
		"currentVoice":  sender.voiceChannel,
		"voicePeers":    voicePeers,
		"voiceMembers":  voiceMembers,
	})
	h.broadcastChannelsState()
}

func (h *Hub) onSetVoiceChannel(c *websocket.Conn, sender *client, msg map[string]any) {
	channelID := strings.TrimSpace(asString(msg["channelId"]))
	st := h.getState()
	st.mu.Lock()
	if _, ok := st.voiceChannels[channelID]; !ok {
		st.mu.Unlock()
		h.emitServerLog("warn", "channel.voice_missing", "Voice channel not found.", sender.nickname, map[string]string{"channelId": channelID})
		h.sendMap(c, map[string]any{"type": "error", "message": "Голосовой канал не найден."})
		return
	}
	oldVoice := sender.voiceChannel
	sender.voiceChannel = channelID
	textChannels := channelsSorted(st.textChannels)
	voiceChannels := channelsSorted(st.voiceChannels)
	newVoicePeers := peersForVoiceChannelLocked(st, sender.voiceChannel, sender.nickname)
	oldVoicePeers := peersForVoiceChannelLocked(st, oldVoice, sender.nickname)
	voiceMembers := voiceMembersByChannelLocked(st)
	st.mu.Unlock()
	h.emitServerLog("info", "channel.voice_set", "Participant switched voice channel.", sender.nickname, map[string]string{"from": oldVoice, "to": channelID})

	h.sendMap(c, map[string]any{
		"type":          "channels-state",
		"textChannels":  textChannels,
		"voiceChannels": voiceChannels,
		"currentText":   sender.textChannel,
		"currentVoice":  sender.voiceChannel,
		"voicePeers":    newVoicePeers,
		"voiceMembers":  voiceMembers,
	})
	for _, nick := range oldVoicePeers {
		h.sendMap(c, map[string]any{"type": "peer-left", "nickname": nick})
	}
	h.broadcastToVoiceChannel(map[string]any{"type": "peer-left", "nickname": sender.nickname}, oldVoice, c)
	h.broadcastToVoiceChannel(map[string]any{"type": "peer-joined", "nickname": sender.nickname}, sender.voiceChannel, c)
	h.broadcastChannelsState()
}

func (h *Hub) onAdminChannelCreate(c *websocket.Conn, msg map[string]any) {
	if !h.isAdminConn(c) {
		h.sendMap(c, map[string]any{"type": "error", "message": "Неверный пароль админ-панели."})
		return
	}
	kind := strings.TrimSpace(asString(msg["kind"]))
	id := strings.TrimSpace(asString(msg["id"]))
	name := strings.TrimSpace(asString(msg["name"]))
	if id == "" || name == "" {
		h.sendMap(c, map[string]any{"type": "error", "message": "Нужны id и имя канала."})
		return
	}
	st := h.getState()
	st.mu.Lock()
	switch kind {
	case "text":
		st.textChannels[id] = ChatChannel{ID: id, Name: name}
	case "voice":
		st.voiceChannels[id] = ChatChannel{ID: id, Name: name}
	default:
		st.mu.Unlock()
		h.sendMap(c, map[string]any{"type": "error", "message": "Неизвестный тип канала."})
		return
	}
	st.mu.Unlock()
	h.broadcastChannelsState()
}

func (h *Hub) onAdminChannelRename(c *websocket.Conn, msg map[string]any) {
	if !h.isAdminConn(c) {
		h.sendMap(c, map[string]any{"type": "error", "message": "Неверный пароль админ-панели."})
		return
	}
	kind := strings.TrimSpace(asString(msg["kind"]))
	id := strings.TrimSpace(asString(msg["id"]))
	name := strings.TrimSpace(asString(msg["name"]))
	if id == "" || name == "" {
		h.sendMap(c, map[string]any{"type": "error", "message": "Нужны id и имя канала."})
		return
	}
	st := h.getState()
	st.mu.Lock()
	switch kind {
	case "text":
		if _, ok := st.textChannels[id]; !ok {
			st.mu.Unlock()
			h.sendMap(c, map[string]any{"type": "error", "message": "Канал не найден."})
			return
		}
		st.textChannels[id] = ChatChannel{ID: id, Name: name}
	case "voice":
		if _, ok := st.voiceChannels[id]; !ok {
			st.mu.Unlock()
			h.sendMap(c, map[string]any{"type": "error", "message": "Канал не найден."})
			return
		}
		st.voiceChannels[id] = ChatChannel{ID: id, Name: name}
	default:
		st.mu.Unlock()
		h.sendMap(c, map[string]any{"type": "error", "message": "Неизвестный тип канала."})
		return
	}
	st.mu.Unlock()
	h.broadcastChannelsState()
}

func (h *Hub) onAdminChannelDelete(c *websocket.Conn, msg map[string]any) {
	if !h.isAdminConn(c) {
		h.sendMap(c, map[string]any{"type": "error", "message": "Неверный пароль админ-панели."})
		return
	}
	kind := strings.TrimSpace(asString(msg["kind"]))
	id := strings.TrimSpace(asString(msg["id"]))
	if id == "" {
		h.sendMap(c, map[string]any{"type": "error", "message": "Нужен id канала."})
		return
	}
	st := h.getState()
	st.mu.Lock()
	switch kind {
	case "text":
		if id == "text-general" {
			st.mu.Unlock()
			h.sendMap(c, map[string]any{"type": "error", "message": "Нельзя удалить канал по умолчанию."})
			return
		}
		delete(st.textChannels, id)
		for _, cl := range st.clientsByConn {
			if cl.textChannel == id {
				cl.textChannel = "text-general"
			}
		}
	case "voice":
		if id == "voice-general" {
			st.mu.Unlock()
			h.sendMap(c, map[string]any{"type": "error", "message": "Нельзя удалить канал по умолчанию."})
			return
		}
		delete(st.voiceChannels, id)
		for _, cl := range st.clientsByConn {
			if cl.voiceChannel == id {
				cl.voiceChannel = "voice-general"
			}
		}
	default:
		st.mu.Unlock()
		h.sendMap(c, map[string]any{"type": "error", "message": "Неизвестный тип канала."})
		return
	}
	st.mu.Unlock()
	h.broadcastChannelsState()
}

func (h *Hub) adminPanelSecretOk(msg map[string]any) bool {
	sec := asString(msg["secret"])
	return sec == h.opts.AdminPanelPassword
}

func (h *Hub) isAdminConn(c *websocket.Conn) bool {
	st := h.getState()
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.adminByConn[c]
}

func toHistoryPayload(msgs []chatstore.Message) []map[string]any {
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		row := map[string]any{
			"id":        m.ID,
			"nickname":  m.Nickname,
			"text":      m.Text,
			"createdAt": m.CreatedAt.UTC().Format(time.RFC3339Nano),
			"reactions": m.Reactions,
		}
		if m.ImageMime != "" && m.ImageData != "" {
			row["imageMime"] = m.ImageMime
			row["imageData"] = m.ImageData
		}
		out = append(out, row)
	}
	return out
}

func (h *Hub) getSender(c *websocket.Conn) *client {
	st := h.getState()
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.clientsByConn[c]
}

func (h *Hub) leave(c *websocket.Conn) {
	st := h.getState()
	st.mu.Lock()
	cl := st.clientsByConn[c]
	if cl == nil {
		w := st.writersByConn[c]
		delete(st.writersByConn, c)
		st.mu.Unlock()
		if w != nil {
			w.close()
		}
		return
	}
	delete(st.clientsByConn, c)
	delete(st.connsByNickname, cl.nickname)
	delete(st.adminByConn, c)
	w := st.writersByConn[c]
	delete(st.writersByConn, c)
	st.mu.Unlock()

	h.emitServerLog("info", "leave", "Participant left the room.", cl.nickname, map[string]string{"voiceChannel": cl.voiceChannel})
	h.broadcastToVoiceChannel(map[string]any{"type": "peer-left", "nickname": cl.nickname}, cl.voiceChannel, nil)
	h.broadcastChannelsState()
	if w != nil {
		w.close()
	}
}

func (h *Hub) send(conn *websocket.Conn, payload any) {
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.sendBytes(conn, b)
}

func (h *Hub) sendMap(conn *websocket.Conn, payload map[string]any) {
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.sendBytes(conn, b)
}

func (h *Hub) broadcastMap(payload map[string]any, except *websocket.Conn) {
	st := h.getState()
	st.mu.Lock()
	conns := make([]*websocket.Conn, 0, len(st.writersByConn))
	for conn := range st.writersByConn {
		if except != nil && conn == except {
			continue
		}
		conns = append(conns, conn)
	}
	st.mu.Unlock()

	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	for _, conn := range conns {
		h.sendBytes(conn, b)
	}
}

func (h *Hub) sendBytes(conn *websocket.Conn, b []byte) {
	st := h.getState()
	st.mu.Lock()
	w := st.writersByConn[conn]
	st.mu.Unlock()
	if w == nil {
		return
	}
	w.send(b)
}

func asString(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	s := strings.TrimSpace(string(b))
	s = strings.TrimPrefix(s, "\"")
	s = strings.TrimSuffix(s, "\"")
	return strings.TrimSpace(s)
}

func channelsSorted(src map[string]ChatChannel) []ChatChannel {
	out := make([]ChatChannel, 0, len(src))
	for _, ch := range src {
		out = append(out, ch)
	}
	coll := collate.New(language.Russian)
	sort.Slice(out, func(i, j int) bool {
		return coll.CompareString(out[i].Name, out[j].Name) < 0
	})
	return out
}

func peersForVoiceChannelLocked(st *hubState, voiceChannel string, excludeNickname string) []string {
	out := make([]string, 0, len(st.clientsByConn))
	for _, cl := range st.clientsByConn {
		if cl == nil || cl.voiceChannel != voiceChannel || cl.nickname == excludeNickname {
			continue
		}
		out = append(out, cl.nickname)
	}
	coll := collate.New(language.Russian)
	sort.Slice(out, func(i, j int) bool {
		return coll.CompareString(out[i], out[j]) < 0
	})
	return out
}

func voiceMembersByChannelLocked(st *hubState) map[string][]string {
	out := make(map[string][]string, len(st.voiceChannels))
	for id := range st.voiceChannels {
		out[id] = []string{}
	}
	for _, cl := range st.clientsByConn {
		if cl == nil {
			continue
		}
		out[cl.voiceChannel] = append(out[cl.voiceChannel], cl.nickname)
	}
	coll := collate.New(language.Russian)
	for id := range out {
		sort.Slice(out[id], func(i, j int) bool {
			return coll.CompareString(out[id][i], out[id][j]) < 0
		})
	}
	return out
}

func (h *Hub) broadcastChannelsState() {
	st := h.getState()
	st.mu.Lock()
	textChannels := channelsSorted(st.textChannels)
	voiceChannels := channelsSorted(st.voiceChannels)
	voiceMembers := voiceMembersByChannelLocked(st)
	st.mu.Unlock()
	h.broadcastMap(
		map[string]any{
			"type":          "channels-state",
			"textChannels":  textChannels,
			"voiceChannels": voiceChannels,
			"voiceMembers":  voiceMembers,
		},
		nil,
	)
}

func (h *Hub) broadcastToVoiceChannel(payload map[string]any, voiceChannel string, except *websocket.Conn) {
	st := h.getState()
	st.mu.Lock()
	conns := make([]*websocket.Conn, 0, len(st.writersByConn))
	for conn, cl := range st.clientsByConn {
		if cl == nil || cl.voiceChannel != voiceChannel {
			continue
		}
		if except != nil && conn == except {
			continue
		}
		conns = append(conns, conn)
	}
	st.mu.Unlock()

	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	for _, conn := range conns {
		h.sendBytes(conn, b)
	}
}

func (h *Hub) broadcastToTextChannel(payload map[string]any, textChannel string, except *websocket.Conn) {
	st := h.getState()
	st.mu.Lock()
	conns := make([]*websocket.Conn, 0, len(st.writersByConn))
	for conn, cl := range st.clientsByConn {
		if cl == nil || cl.textChannel != textChannel {
			continue
		}
		if except != nil && conn == except {
			continue
		}
		conns = append(conns, conn)
	}
	st.mu.Unlock()

	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	for _, conn := range conns {
		h.sendBytes(conn, b)
	}
}

