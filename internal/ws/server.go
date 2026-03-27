package ws

import (
	"context"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"

	"zalupa228local/internal/chatstore"
	memstore "zalupa228local/internal/chatstore/memory"
)

type HubOptions struct {
	AdminPanelPassword string
	MongoURI           string
	EnableServerLogs   bool
}

type Hub struct {
	opts HubOptions

	stateOnce sync.Once
	state     *hubState

	storeMu sync.RWMutex
	store   chatStore
	logs    serverLogState
}

func NewHub(opts HubOptions) *Hub {
	h := &Hub{opts: opts}
	h.store = memstore.New(100)
	return h
}

type chatStore interface {
	History(ctx context.Context, limit int) ([]chatstore.Message, error)
	Create(ctx context.Context, nickname, text, imageMime, imageData string) (chatstore.Message, error)
	EditText(ctx context.Context, id, nickname, newText string) (chatstore.Message, bool, error)
	Delete(ctx context.Context, id, nickname string) (bool, error)
	ToggleReaction(ctx context.Context, id, emoji, nickname string) (map[string][]string, bool, error)
}

func WithWebSocketFallback(hub *Hub, fallback http.Handler) http.Handler {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if websocket.IsWebSocketUpgrade(r) {
			c, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			go hub.handleConn(r.Context(), c)
			return
		}
		fallback.ServeHTTP(w, r)
	})
}

func (h *Hub) getStore() chatStore {
	h.storeMu.RLock()
	defer h.storeMu.RUnlock()
	return h.store
}

func (h *Hub) setStore(s chatStore) {
	h.storeMu.Lock()
	defer h.storeMu.Unlock()
	h.store = s
}

