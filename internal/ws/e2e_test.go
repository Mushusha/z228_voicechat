package ws

import (
	"testing"
)

func TestEndToEndChatFlow(t *testing.T) {
	_, srv := newTestWSServer(t, false)

	a := dialWS(t, srv)
	waitForType(t, a, "hello")
	waitForType(t, a, "channels-state")
	writeJSON(t, a, map[string]any{"type": "join", "nickname": "alice"})
	waitForType(t, a, "join-accepted")
	waitForType(t, a, "channels-state")
	waitForType(t, a, "chat-history")

	b := dialWS(t, srv)
	waitForType(t, b, "hello")
	waitForType(t, b, "channels-state")
	writeJSON(t, b, map[string]any{"type": "join", "nickname": "bob"})
	waitForType(t, b, "join-accepted")
	waitForType(t, b, "channels-state")
	waitForType(t, b, "chat-history")

	writeJSON(t, a, map[string]any{"type": "chat", "text": "hello"})
	chatMsg := waitForType(t, a, "chat-message")
	waitForType(t, b, "chat-message")
	msgID, _ := chatMsg["id"].(string)
	if msgID == "" {
		t.Fatalf("chat id = %#v", chatMsg["id"])
	}

	writeJSON(t, a, map[string]any{"type": "chat-react", "id": msgID, "emoji": "👍"})
	waitForType(t, a, "chat-message-reactions")
	waitForType(t, b, "chat-message-reactions")

	writeJSON(t, a, map[string]any{"type": "chat-edit", "id": msgID, "text": "hello-2"})
	updated := waitForType(t, a, "chat-message-updated")
	if updated["text"] != "hello-2" {
		t.Fatalf("updated text = %v", updated["text"])
	}
	waitForType(t, b, "chat-message-updated")

	writeJSON(t, a, map[string]any{"type": "chat-delete", "id": msgID})
	waitForType(t, a, "chat-message-deleted")
	waitForType(t, b, "chat-message-deleted")
}
