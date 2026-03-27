package ws

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func newTestWSServer(t *testing.T, enableLogs bool) (*Hub, *httptest.Server) {
	t.Helper()
	hub := NewHub(HubOptions{
		AdminPanelPassword: "secret",
		EnableServerLogs:   enableLogs,
	})
	srv := httptest.NewServer(WithWebSocketFallback(hub, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("fallback"))
	})))
	t.Cleanup(srv.Close)
	return hub, srv
}

func dialWS(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Dial websocket: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func writeJSON(t *testing.T, conn *websocket.Conn, payload map[string]any) {
	t.Helper()
	if err := conn.WriteJSON(payload); err != nil {
		t.Fatalf("WriteJSON: %v", err)
	}
}

func readMessage(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, b, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	return out
}

func waitForType(t *testing.T, conn *websocket.Conn, want string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		msg := readMessage(t, conn)
		if msg["type"] == want {
			return msg
		}
	}
	t.Fatalf("timeout waiting for %s", want)
	return nil
}
