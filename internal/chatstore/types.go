package chatstore

import "time"

type Message struct {
	ID        string
	Nickname  string
	Text      string
	CreatedAt time.Time

	// ChannelID is the text channel this message belongs to (e.g. "text-general").
	// Empty means legacy documents without a channel (treated as text-general when loading history).
	ChannelID string

	ImageMime string
	ImageData string

	Reactions map[string][]string
}

