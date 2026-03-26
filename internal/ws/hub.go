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
	ws       *websocket.Conn
	nickname string
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

	clientsByConn      map[*websocket.Conn]*client
	connsByNickname    map[string]*websocket.Conn
	writersByConn      map[*websocket.Conn]*connWriter
}

func (h *Hub) getState() *hubState {
	h.stateOnce.Do(func() {
		h.state = &hubState{
			clientsByConn:   make(map[*websocket.Conn]*client),
			connsByNickname: make(map[string]*websocket.Conn),
			writersByConn:   make(map[*websocket.Conn]*connWriter),
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
		case "join":
			h.onJoin(c, msg)
		default:
			sender := h.getSender(c)
			if sender == nil {
				h.sendMap(c, map[string]any{"type": "error", "message": "Join before signaling."})
				continue
			}
			switch msgType {
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
		"chat-message-deleted", "chat-message-reactions":
		return true
	default:
		return false
	}
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

	st.clientsByConn[c] = &client{ws: c, nickname: nickname}
	st.connsByNickname[nickname] = c

	peers := make([]string, 0, len(st.connsByNickname))
	for name := range st.connsByNickname {
		if name != nickname {
			peers = append(peers, name)
		}
	}
	st.mu.Unlock()

	h.sendMap(c, map[string]any{"type": "join-accepted", "nickname": nickname, "peers": peers})
	h.broadcastMap(map[string]any{"type": "peer-joined", "nickname": nickname}, c)

	go func() {
		msgs, err := h.getStore().History(context.Background(), 100)
		if err != nil {
			log.Printf("chat-history: %v", err)
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
	st.mu.Unlock()

	if targetConn == nil {
		h.sendMap(c, map[string]any{
			"type":   "signal-error",
			"target": target,
			"reason": "Target not found.",
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
	h.sendMap(c, map[string]any{"type": "admin-verify-ok"})
}

func (h *Hub) onAdminPeers(c *websocket.Conn, msg map[string]any) {
	if !h.adminPanelSecretOk(msg) {
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
	if !h.adminPanelSecretOk(msg) {
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

func (h *Hub) adminPanelSecretOk(msg map[string]any) bool {
	sec := asString(msg["secret"])
	return sec == h.opts.AdminPanelPassword
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
	w := st.writersByConn[c]
	delete(st.writersByConn, c)
	st.mu.Unlock()

	h.broadcastMap(map[string]any{"type": "peer-left", "nickname": cl.nickname}, nil)
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

