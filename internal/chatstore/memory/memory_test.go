package memory

import (
	"context"
	"testing"
)

func TestStoreCreateEditDeleteAndReact(t *testing.T) {
	s := New(3)

	msg, err := s.Create(context.Background(), "alice", "hello", "", "")
	if err != nil {
		t.Fatalf("Create error: %v", err)
	}

	edited, found, err := s.EditText(context.Background(), msg.ID, "alice", "hello-2")
	if err != nil || !found {
		t.Fatalf("EditText found=%v err=%v", found, err)
	}
	if edited.Text != "hello-2" {
		t.Fatalf("Text = %q, want hello-2", edited.Text)
	}

	reactions, found, err := s.ToggleReaction(context.Background(), msg.ID, "👍", "alice")
	if err != nil || !found {
		t.Fatalf("ToggleReaction found=%v err=%v", found, err)
	}
	if len(reactions["👍"]) != 1 {
		t.Fatalf("reactions = %#v", reactions)
	}

	ok, err := s.Delete(context.Background(), msg.ID, "alice")
	if err != nil || !ok {
		t.Fatalf("Delete ok=%v err=%v", ok, err)
	}
}

func TestStoreHistoryRespectsLimit(t *testing.T) {
	s := New(2)
	for i := 0; i < 3; i++ {
		if _, err := s.Create(context.Background(), "alice", "m", "", ""); err != nil {
			t.Fatalf("Create error: %v", err)
		}
	}
	history, err := s.History(context.Background(), 10)
	if err != nil {
		t.Fatalf("History error: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("len(History) = %d, want 2", len(history))
	}
}
