package ws

import "testing"

func TestJoinRejectsDuplicateNicknameAndBroadcastsServerLog(t *testing.T) {
	_, srv := newTestWSServer(t, true)

	a := dialWS(t, srv)
	waitForType(t, a, "hello")
	waitForType(t, a, "server-log-history")
	waitForType(t, a, "channels-state")
	writeJSON(t, a, map[string]any{"type": "join", "nickname": "alice"})
	waitForType(t, a, "join-accepted")
	waitForType(t, a, "channels-state")
	waitForType(t, a, "server-log")

	b := dialWS(t, srv)
	waitForType(t, b, "hello")
	waitForType(t, b, "server-log-history")
	waitForType(t, b, "channels-state")
	writeJSON(t, b, map[string]any{"type": "join", "nickname": "alice"})
	rejected := waitForType(t, b, "join-rejected")
	if rejected["reason"] != "Nickname already taken." {
		t.Fatalf("reason = %v", rejected["reason"])
	}
	logMsg := waitForType(t, a, "server-log")
	entry := logMsg["log"].(map[string]any)
	if entry["event"] != "join.rejected" {
		t.Fatalf("event = %v, want join.rejected", entry["event"])
	}
}

func TestSignalMissingTargetReturnsSignalError(t *testing.T) {
	_, srv := newTestWSServer(t, false)

	a := dialWS(t, srv)
	waitForType(t, a, "hello")
	waitForType(t, a, "channels-state")
	writeJSON(t, a, map[string]any{"type": "join", "nickname": "alice"})
	waitForType(t, a, "join-accepted")

	writeJSON(t, a, map[string]any{
		"type":   "signal",
		"target": "ghost",
		"payload": map[string]any{
			"description": map[string]any{"type": "offer", "sdp": "v=0"},
		},
	})

	errMsg := waitForType(t, a, "signal-error")
	if errMsg["reason"] != "Target not found." {
		t.Fatalf("reason = %v", errMsg["reason"])
	}
}
