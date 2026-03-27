package chatstore

import (
	"context"
	"errors"
)

var (
	ErrEmptyAfterEdit = errors.New("empty after edit")
)

type Store interface {
	History(ctx context.Context, channelID string, limit int) ([]Message, error)
	Create(ctx context.Context, channelID, nickname, text, imageMime, imageData string) (Message, error)
	EditText(ctx context.Context, id, nickname, newText string) (Message, bool, error)
	Delete(ctx context.Context, id, nickname string) (bool, error)
	ToggleReaction(ctx context.Context, id, emoji, nickname string) (map[string][]string, bool, error)
}

