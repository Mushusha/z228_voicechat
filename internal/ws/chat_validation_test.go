package ws

import (
	"strings"
	"testing"
)

func TestNormalizeIncomingImageAcceptsDataURL(t *testing.T) {
	raw := map[string]any{
		"mime": "image/png",
		"data": "data:image/png;base64," + strings.Repeat("A", 64),
	}
	got := normalizeIncomingImage(raw)
	if got == nil {
		t.Fatal("normalizeIncomingImage returned nil")
	}
	if got.Mime != "image/png" {
		t.Fatalf("Mime = %q, want image/png", got.Mime)
	}
}

func TestNormalizeIncomingImageRejectsShortPayload(t *testing.T) {
	raw := map[string]any{"mime": "image/png", "data": strings.Repeat("A", 8)}
	if got := normalizeIncomingImage(raw); got != nil {
		t.Fatalf("normalizeIncomingImage = %#v, want nil", got)
	}
}

func TestNormalizeReactionEmojiRejectsControlChars(t *testing.T) {
	if got := normalizeReactionEmoji("ok\x01"); got != "" {
		t.Fatalf("normalizeReactionEmoji = %q, want empty", got)
	}
}
