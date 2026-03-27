package memory

import (
	"context"
	"strconv"
	"sync"
	"time"

	"zalupa228local/internal/chatstore"
)

type Store struct {
	mu     sync.Mutex
	seq    int
	limit  int
	rows   []chatstore.Message
}

func New(limit int) *Store {
	return &Store{seq: 1, limit: limit, rows: make([]chatstore.Message, 0, limit)}
}

func messageMatchesTextChannel(msgChannel, filterChannel string) bool {
	if filterChannel == "" {
		return false
	}
	if msgChannel == filterChannel {
		return true
	}
	if filterChannel == "text-general" && msgChannel == "" {
		return true
	}
	return false
}

func (s *Store) History(ctx context.Context, channelID string, limit int) ([]chatstore.Message, error) {
	_ = ctx
	s.mu.Lock()
	defer s.mu.Unlock()
	matched := make([]chatstore.Message, 0)
	for _, m := range s.rows {
		if messageMatchesTextChannel(m.ChannelID, channelID) {
			matched = append(matched, m)
		}
	}
	n := len(matched)
	if limit <= 0 || limit > n {
		limit = n
	}
	out := make([]chatstore.Message, limit)
	copy(out, matched[n-limit:])
	return out, nil
}

func (s *Store) Create(ctx context.Context, channelID, nickname, text, imageMime, imageData string) (chatstore.Message, error) {
	_ = ctx
	s.mu.Lock()
	defer s.mu.Unlock()
	m := chatstore.Message{
		ID:        strconv.Itoa(s.seq),
		ChannelID: channelID,
		Nickname:  nickname,
		Text:      text,
		ImageMime: imageMime,
		ImageData: imageData,
		Reactions: map[string][]string{},
		CreatedAt: time.Now(),
	}
	s.seq++
	s.rows = append(s.rows, m)
	for len(s.rows) > s.limit {
		s.rows = s.rows[1:]
	}
	return m, nil
}

func (s *Store) EditText(ctx context.Context, id, nickname, newText string) (chatstore.Message, bool, error) {
	_ = ctx
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.rows {
		if s.rows[i].ID == id && s.rows[i].Nickname == nickname {
			if newText == "" && s.rows[i].ImageMime == "" {
				return chatstore.Message{}, true, chatstore.ErrEmptyAfterEdit
			}
			s.rows[i].Text = newText
			return s.rows[i], true, nil
		}
	}
	return chatstore.Message{}, false, nil
}

func (s *Store) Delete(ctx context.Context, id, nickname string) (bool, error) {
	_ = ctx
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.rows {
		if s.rows[i].ID == id && s.rows[i].Nickname == nickname {
			s.rows = append(s.rows[:i], s.rows[i+1:]...)
			return true, nil
		}
	}
	return false, nil
}

func (s *Store) ToggleReaction(ctx context.Context, id, emoji, nickname string) (map[string][]string, bool, error) {
	_ = ctx
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.rows {
		if s.rows[i].ID != id {
			continue
		}
		if s.rows[i].Reactions == nil {
			s.rows[i].Reactions = map[string][]string{}
		}
		toggleReactionOnStore(s.rows[i].Reactions, emoji, nickname)
		return cloneReactions(s.rows[i].Reactions), true, nil
	}
	return nil, false, nil
}

func toggleReactionOnStore(reactions map[string][]string, emoji, nickname string) {
	arr := reactions[emoji]
	for i := range arr {
		if arr[i] == nickname {
			arr = append(arr[:i], arr[i+1:]...)
			if len(arr) == 0 {
				delete(reactions, emoji)
			} else {
				reactions[emoji] = arr
			}
			return
		}
	}
	reactions[emoji] = append(arr, nickname)
}

func cloneReactions(in map[string][]string) map[string][]string {
	out := make(map[string][]string, len(in))
	for k, v := range in {
		if len(v) == 0 {
			continue
		}
		cp := make([]string, len(v))
		copy(cp, v)
		out[k] = cp
	}
	return out
}

