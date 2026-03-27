package ws

import "testing"

func TestNormalizeWsMessageType(t *testing.T) {
	got := normalizeWsMessageType("  SIGNAL—ERROR\u200b ")
	if got != "signal-error" {
		t.Fatalf("normalizeWsMessageType = %q, want signal-error", got)
	}
}
