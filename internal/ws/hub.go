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
	micEnabled  bool
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
	presenceByConn  map[*websocket.Conn]string
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
			presenceByConn:  make(map[*websocket.Conn]string),
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

	h.send(c, HelloPayload{Type: "hello", AdminPanel: true, ChatMessageOps: true})
	h.onGetChannels(c)

	for {
		_, raw, err := c.ReadMessage()
		if err != nil {
			h.leave(c)
			return
		}

		var msg map[string]any
		if err := json.Unmarshal(raw, &msg); err != nil {
			h.sendMap(c, map[string]any{"type": "error", "message": "Invalid JSON payload."})
			continue
		}
		if msg == nil {
			h.sendMap(c, map[string]any{"type": "error", "message": "Invalid message shape."})
			continue
		}

		msgType := normalizeWsMessageType(msg["type"])
		if msgType == "" {
			log.Printf("WebSocket message without type: %v", msg)
			continue
		}

		if clientShouldNotSend(msgType) {
			continue
		}

		switch msgType {
		case "get-channels":
			h.onGetChannels(c)
		case "presence":
			h.onPresence(c, msg)
		case "join":
			h.onJoin(c, msg)
		default:
			sender := h.getSender(c)
			if sender == nil {
				h.sendMap(c, map[string]any{"type": "error", "message": "Join before signaling."})
				continue
			}
			switch msgType {
			case "leave":
				h.leave(c)
			case "set-text-channel":
				h.onSetTextChannel(c, sender, msg)
			case "set-voice-channel":
				h.onSetVoiceChannel(c, sender, msg)
			case "set-mic":
				h.onSetMic(c, sender, msg)
			case "rename":
				h.onRename(c, sender, msg)
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
		"chat-message-deleted", "chat-message-reactions", "channels-state",
		"rename-ok", "rename-rejected", "mic-state", "online-state":
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
	voiceMic := voiceMicByNicknameLocked(st)
	onlineUsers := onlineUsersLocked(st)
	st.mu.Unlock()
	h.sendMap(c, map[string]any{
		"type":          "channels-state",
		"textChannels":  textChannels,
		"voiceChannels": voiceChannels,
		"voiceMembers":  voiceMembers,
		"voiceMic":      voiceMic,
		"onlineUsers":   onlineUsers,
	})
}

func (h *Hub) onPresence(c *websocket.Conn, msg map[string]any) {
	nickname := strings.TrimSpace(asString(msg["nickname"]))
	st := h.getState()
	st.mu.Lock()
	if nickname == "" {
		delete(st.presenceByConn, c)
	} else {
		st.presenceByConn[c] = nickname
	}
	st.mu.Unlock()
	h.broadcastOnlineState()
}

func (h *Hub) onJoin(c *websocket.Conn, msg map[string]any) {
	nickname := strings.TrimSpace(asString(msg["nickname"]))
	if nickname == "" {
		h.sendMap(c, map[string]any{"type": "join-rejected", "reason": "Nickname is required."})
		return
	}

	st := h.getState()
	st.mu.Lock()
	if _, ok := st.clientsByConn[c]; ok {
		st.mu.Unlock()
		h.sendMap(c, map[string]any{"type": "join-rejected", "reason": "Already joined."})
		return
	}
	if _, ok := st.connsByNickname[nickname]; ok {
		st.mu.Unlock()
		h.sendMap(c, map[string]any{"type": "join-rejected", "reason": "Nickname already taken."})
		return
	}

	textChannel := strings.TrimSpace(asString(msg["textChannel"]))
	if textChannel != "" {
		if _, ok := st.textChannels[textChannel]; !ok {
			textChannel = "text-general"
		}
	}
	voiceChannel := strings.TrimSpace(asString(msg["voiceChannel"]))
	if voiceChannel != "" {
		if _, ok := st.voiceChannels[voiceChannel]; !ok {
			voiceChannel = "voice-general"
		}
	}

	st.clientsByConn[c] = &client{ws: c, nickname: nickname, textChannel: textChannel, voiceChannel: voiceChannel, micEnabled: true}
	st.connsByNickname[nickname] = c

	peers := make([]string, 0, len(st.connsByNickname))
	if voiceChannel != "" {
		for name, conn := range st.connsByNickname {
			if name != nickname && st.clientsByConn[conn] != nil && st.clientsByConn[conn].voiceChannel == voiceChannel {
				peers = append(peers, name)
			}
		}
	}
	textChannels := channelsSorted(st.textChannels)
	voiceChannels := channelsSorted(st.voiceChannels)
	voicePeers := peersForVoiceChannelLocked(st, voiceChannel, nickname)
	voiceMembers := voiceMembersByChannelLocked(st)
	voiceMic := voiceMicByNicknameLocked(st)
	st.mu.Unlock()

	h.sendMap(c, map[string]any{"type": "join-accepted", "nickname": nickname, "peers": peers})
	h.sendMap(c, map[string]any{
		"type":         "channels-state",
		"textChannels": textChannels,
		"voiceChannels": voiceChannels,
		"currentText":  textChannel,
		"currentVoice": voiceChannel,
		"voicePeers":   voicePeers,
		"voiceMembers": voiceMembers,
		"voiceMic":     voiceMic,
	})
	if voiceChannel != "" {
		h.broadcastToVoiceChannel(map[string]any{"type": "peer-joined", "nickname": nickname}, voiceChannel, c)
	}
	h.broadcastChannelsState()

	h.sendChatHistoryAsync(c, textChannel)
}

func (h *Hub) onSignal(c *websocket.Conn, sender *client, msg map[string]any) {
	target := strings.TrimSpace(asString(msg["target"]))
	payload := msg["payload"]
	if sender.voiceChannel == "" {
		h.sendMap(c, map[string]any{
			"type":   "signal-error",
			"target": target,
			"reason": "Sender not in voice channel.",
		})
		return
	}

	st := h.getState()
	st.mu.Lock()
	targetConn := st.connsByNickname[target]
	targetClient := st.clientsByConn[targetConn]
	st.mu.Unlock()

	if targetConn == nil || targetClient == nil {
		h.sendMap(c, map[string]any{
			"type":   "signal-error",
			"target": target,
			"reason": "Target not found.",
		})
		return
	}
	if targetClient.voiceChannel == "" || targetClient.voiceChannel != sender.voiceChannel {
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
}

func (h *Hub) onAdminVerify(c *websocket.Conn, msg map[string]any) {
	if !h.adminPanelSecretOk(msg) {
		h.sendMap(c, map[string]any{"type": "error", "message": "Неверный пароль."})
		return
	}
	st := h.getState()
	st.mu.Lock()
	st.adminByConn[c] = true
	st.mu.Unlock()
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
		h.sendMap(c, map[string]any{"type": "error", "message": "Участник не в комнате."})
		return
	}

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
	if channelID != "" {
		if _, ok := st.textChannels[channelID]; !ok {
			st.mu.Unlock()
			h.sendMap(c, map[string]any{"type": "error", "message": "Текстовый канал не найден."})
			return
		}
	}
	sender.textChannel = channelID
	textChannels := channelsSorted(st.textChannels)
	voiceChannels := channelsSorted(st.voiceChannels)
	voicePeers := peersForVoiceChannelLocked(st, sender.voiceChannel, sender.nickname)
	voiceMembers := voiceMembersByChannelLocked(st)
	voiceMic := voiceMicByNicknameLocked(st)
	st.mu.Unlock()
	h.sendMap(c, map[string]any{
		"type":          "channels-state",
		"textChannels":  textChannels,
		"voiceChannels": voiceChannels,
		"currentText":   sender.textChannel,
		"currentVoice":  sender.voiceChannel,
		"voicePeers":    voicePeers,
		"voiceMembers":  voiceMembers,
		"voiceMic":      voiceMic,
	})
	h.broadcastChannelsState()

	h.sendChatHistoryAsync(c, sender.textChannel)
}

func (h *Hub) sendChatHistoryAsync(conn *websocket.Conn, textChannel string) {
	if textChannel == "" {
		h.sendMap(conn, map[string]any{"type": "chat-history", "messages": []any{}, "channelId": ""})
		return
	}
	go func() {
		msgs, err := h.getStore().History(context.Background(), textChannel, 100)
		if err != nil {
			log.Printf("chat-history: %v", err)
			h.sendMap(conn, map[string]any{"type": "error", "message": "Failed to load chat history."})
			return
		}
		h.sendMap(conn, map[string]any{
			"type":      "chat-history",
			"messages":  toHistoryPayload(msgs),
			"channelId": textChannel,
		})
	}()
}

func (h *Hub) onRename(c *websocket.Conn, sender *client, msg map[string]any) {
	newNickname := strings.TrimSpace(asString(msg["nickname"]))
	if newNickname == "" {
		h.sendMap(c, map[string]any{"type": "rename-rejected", "reason": "Nickname is required."})
		return
	}
	oldNickname := sender.nickname
	if oldNickname == newNickname {
		h.sendMap(c, map[string]any{"type": "rename-ok", "oldNickname": oldNickname, "nickname": oldNickname})
		return
	}

	st := h.getState()
	st.mu.Lock()
	if existingConn, ok := st.connsByNickname[newNickname]; ok && existingConn != c {
		st.mu.Unlock()
		h.sendMap(c, map[string]any{"type": "rename-rejected", "reason": "Nickname already taken."})
		return
	}
	delete(st.connsByNickname, oldNickname)
	st.connsByNickname[newNickname] = c
	sender.nickname = newNickname
	voiceChannel := sender.voiceChannel
	st.mu.Unlock()

	h.sendMap(c, map[string]any{"type": "rename-ok", "oldNickname": oldNickname, "nickname": newNickname})
	if voiceChannel != "" {
		h.broadcastToVoiceChannel(map[string]any{"type": "peer-left", "nickname": oldNickname}, voiceChannel, c)
		h.broadcastToVoiceChannel(map[string]any{"type": "peer-joined", "nickname": newNickname}, voiceChannel, c)
	}
	h.broadcastChannelsState()
}

func (h *Hub) onSetMic(c *websocket.Conn, sender *client, msg map[string]any) {
	enabled := asBool(msg["enabled"], true)
	st := h.getState()
	st.mu.Lock()
	sender.micEnabled = enabled
	voiceChannel := sender.voiceChannel
	nickname := sender.nickname
	st.mu.Unlock()
	if voiceChannel == "" {
		return
	}

	h.broadcastToVoiceChannel(
		map[string]any{
			"type":     "mic-state",
			"nickname": nickname,
			"enabled":  enabled,
		},
		voiceChannel,
		nil,
	)
}

func (h *Hub) onSetVoiceChannel(c *websocket.Conn, sender *client, msg map[string]any) {
	channelID := strings.TrimSpace(asString(msg["channelId"]))
	st := h.getState()
	st.mu.Lock()
	if channelID != "" {
		if _, ok := st.voiceChannels[channelID]; !ok {
			st.mu.Unlock()
			h.sendMap(c, map[string]any{"type": "error", "message": "Голосовой канал не найден."})
			return
		}
	}
	oldVoice := sender.voiceChannel
	sender.voiceChannel = channelID
	textChannels := channelsSorted(st.textChannels)
	voiceChannels := channelsSorted(st.voiceChannels)
	newVoicePeers := peersForVoiceChannelLocked(st, sender.voiceChannel, sender.nickname)
	oldVoicePeers := peersForVoiceChannelLocked(st, oldVoice, sender.nickname)
	voiceMembers := voiceMembersByChannelLocked(st)
	voiceMic := voiceMicByNicknameLocked(st)
	st.mu.Unlock()

	h.sendMap(c, map[string]any{
		"type":          "channels-state",
		"textChannels":  textChannels,
		"voiceChannels": voiceChannels,
		"currentText":   sender.textChannel,
		"currentVoice":  sender.voiceChannel,
		"voicePeers":    newVoicePeers,
		"voiceMembers":  voiceMembers,
		"voiceMic":      voiceMic,
	})
	if oldVoice != "" {
		for _, nick := range oldVoicePeers {
			h.sendMap(c, map[string]any{"type": "peer-left", "nickname": nick})
		}
		h.broadcastToVoiceChannel(map[string]any{"type": "peer-left", "nickname": sender.nickname}, oldVoice, c)
	}
	if sender.voiceChannel != "" {
		h.broadcastToVoiceChannel(map[string]any{"type": "peer-joined", "nickname": sender.nickname}, sender.voiceChannel, c)
	}
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
		ch := m.ChannelID
		if ch == "" {
			ch = "text-general"
		}
		row := map[string]any{
			"id":        m.ID,
			"nickname":  m.Nickname,
			"text":      m.Text,
			"createdAt": m.CreatedAt.UTC().Format(time.RFC3339Nano),
			"reactions": m.Reactions,
			"channelId": ch,
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
		_, hadPresence := st.presenceByConn[c]
		delete(st.presenceByConn, c)
		delete(st.writersByConn, c)
		st.mu.Unlock()
		if w != nil {
			w.close()
		}
		if hadPresence {
			h.broadcastOnlineState()
		}
		return
	}
	delete(st.clientsByConn, c)
	delete(st.connsByNickname, cl.nickname)
	delete(st.adminByConn, c)
	delete(st.presenceByConn, c)
	w := st.writersByConn[c]
	delete(st.writersByConn, c)
	st.mu.Unlock()

	h.broadcastToVoiceChannel(map[string]any{"type": "peer-left", "nickname": cl.nickname}, cl.voiceChannel, nil)
	h.broadcastChannelsState()
	h.broadcastOnlineState()
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

func asBool(v any, def bool) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		s := strings.ToLower(strings.TrimSpace(x))
		switch s {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	case float64:
		return x != 0
	case int:
		return x != 0
	}
	return def
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
	if voiceChannel == "" {
		return []string{}
	}
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
		if cl == nil || cl.voiceChannel == "" {
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

func voiceMicByNicknameLocked(st *hubState) map[string]bool {
	out := make(map[string]bool, len(st.clientsByConn))
	for _, cl := range st.clientsByConn {
		if cl == nil || cl.nickname == "" {
			continue
		}
		out[cl.nickname] = cl.micEnabled
	}
	return out
}

func onlineUsersLocked(st *hubState) []string {
	seen := make(map[string]struct{}, len(st.clientsByConn)+len(st.presenceByConn))
	for _, cl := range st.clientsByConn {
		if cl == nil || cl.nickname == "" {
			continue
		}
		seen[cl.nickname] = struct{}{}
	}
	for _, nickname := range st.presenceByConn {
		nickname = strings.TrimSpace(nickname)
		if nickname == "" {
			continue
		}
		seen[nickname] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for nickname := range seen {
		out = append(out, nickname)
	}
	coll := collate.New(language.Russian)
	sort.Slice(out, func(i, j int) bool {
		return coll.CompareString(out[i], out[j]) < 0
	})
	return out
}

func (h *Hub) broadcastChannelsState() {
	st := h.getState()
	st.mu.Lock()
	textChannels := channelsSorted(st.textChannels)
	voiceChannels := channelsSorted(st.voiceChannels)
	voiceMembers := voiceMembersByChannelLocked(st)
	voiceMic := voiceMicByNicknameLocked(st)
	onlineUsers := onlineUsersLocked(st)
	st.mu.Unlock()
	h.broadcastMap(
		map[string]any{
			"type":          "channels-state",
			"textChannels":  textChannels,
			"voiceChannels": voiceChannels,
			"voiceMembers":  voiceMembers,
			"voiceMic":      voiceMic,
			"onlineUsers":   onlineUsers,
		},
		nil,
	)
}

func (h *Hub) broadcastOnlineState() {
	st := h.getState()
	st.mu.Lock()
	onlineUsers := onlineUsersLocked(st)
	st.mu.Unlock()
	h.broadcastMap(
		map[string]any{
			"type":        "online-state",
			"onlineUsers": onlineUsers,
		},
		nil,
	)
}

func (h *Hub) broadcastToVoiceChannel(payload map[string]any, voiceChannel string, except *websocket.Conn) {
	if voiceChannel == "" {
		return
	}
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

