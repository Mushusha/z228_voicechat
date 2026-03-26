package chatstore

import "time"

type Message struct {
	ID        string
	Nickname  string
	Text      string
	CreatedAt time.Time

	ImageMime string
	ImageData string

	Reactions map[string][]string
}

