package ws

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const serverLogHistoryLimit = 200

type serverLogEntry struct {
	ID        int64             `json:"id"`
	Level     string            `json:"level"`
	Event     string            `json:"event"`
	Message   string            `json:"message"`
	Nickname  string            `json:"nickname,omitempty"`
	Fields    map[string]string `json:"fields,omitempty"`
	CreatedAt string            `json:"createdAt"`
}

type serverLogState struct {
	mu      sync.Mutex
	nextID  int64
	entries []serverLogEntry
}

func (h *Hub) serverLogsEnabled() bool {
	return h.opts.EnableServerLogs
}

func (h *Hub) appendServerLog(level, event, message, nickname string, fields map[string]string) serverLogEntry {
	h.logs.mu.Lock()
	defer h.logs.mu.Unlock()

	h.logs.nextID++
	entry := serverLogEntry{
		ID:        h.logs.nextID,
		Level:     level,
		Event:     event,
		Message:   message,
		Nickname:  nickname,
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if len(fields) > 0 {
		cp := make(map[string]string, len(fields))
		for k, v := range fields {
			cp[k] = v
		}
		entry.Fields = cp
	}
	h.logs.entries = append(h.logs.entries, entry)
	if len(h.logs.entries) > serverLogHistoryLimit {
		h.logs.entries = h.logs.entries[len(h.logs.entries)-serverLogHistoryLimit:]
	}
	return entry
}

func (h *Hub) emitServerLog(level, event, message, nickname string, fields map[string]string) {
	log.Printf("server-log level=%s event=%s nickname=%q message=%q fields=%v", level, event, nickname, message, fields)
	if !h.serverLogsEnabled() {
		return
	}

	entry := h.appendServerLog(level, event, message, nickname, fields)
	h.broadcastMap(map[string]any{
		"type": "server-log",
		"log":  entry,
	}, nil)
}

func (h *Hub) snapshotServerLogs() []serverLogEntry {
	h.logs.mu.Lock()
	defer h.logs.mu.Unlock()
	out := make([]serverLogEntry, len(h.logs.entries))
	copy(out, h.logs.entries)
	return out
}

func (h *Hub) sendServerLogHistory(c *websocket.Conn) {
	if !h.serverLogsEnabled() {
		return
	}
	h.sendMap(c, map[string]any{
		"type": "server-log-history",
		"logs": h.snapshotServerLogs(),
	})
}

func logFieldValue(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case fmt.Stringer:
		return x.String()
	default:
		return fmt.Sprint(x)
	}
}

func fieldsJSON(fields map[string]string) string {
	if len(fields) == 0 {
		return ""
	}
	b, err := json.Marshal(fields)
	if err != nil {
		return ""
	}
	return string(b)
}
