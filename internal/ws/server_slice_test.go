package ws

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWithWebSocketFallbackServesHTTPRequests(t *testing.T) {
	hub := NewHub(HubOptions{})
	handler := WithWebSocketFallback(hub, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte("ok"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusAccepted)
	}
}
