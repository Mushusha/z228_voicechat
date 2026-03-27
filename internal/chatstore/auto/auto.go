package auto

import (
	"context"
	"log"
	"sync/atomic"
	"time"

	"zalupa228local/internal/chatstore"
	mem "zalupa228local/internal/chatstore/memory"
	mongostore "zalupa228local/internal/chatstore/mongo"
)

type Store struct {
	mongo *mongostore.Store
	mem   *mem.Store
	mongoLive atomic.Bool
}

func New(ctx context.Context, mongoURI string, memStore *mem.Store) *Store {
	if memStore == nil {
		memStore = mem.New(100)
	}
	s := &Store{mem: memStore}
	ctx0, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	m, err := mongostore.New(ctx0, mongoURI)
	if err != nil {
		log.Printf("MongoDB unavailable — chat uses in-memory store (cleared on restart).")
		log.Printf("  Reason: %v", err)
		log.Printf("  Optional: docker compose up, or install MongoDB; MONGODB_URI=%s", mongoURI)
		return s
	}
	if err := m.EnsureIndexes(ctx0); err != nil {
		log.Printf("Mongo ensure indexes: %v", err)
	}
	s.mongo = m
	s.startMongoHealthLoop()
	log.Printf("MongoDB connected — chat persists in the database")
	return s
}

func (s *Store) startMongoHealthLoop() {
	if s.mongo == nil {
		s.mongoLive.Store(false)
		return
	}
	go func() {
		// Keep write path fast: update health in background.
		t := time.NewTicker(1500 * time.Millisecond)
		defer t.Stop()

		probe := func() {
			ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
			defer cancel()
			s.mongoLive.Store(s.mongo.Ping(ctx) == nil)
		}

		probe()
		for range t.C {
			probe()
		}
	}()
}

func (s *Store) liveMongo(_ context.Context) bool {
	if s.mongo == nil {
		return false
	}
	return s.mongoLive.Load()
}

func (s *Store) LiveMongo(ctx context.Context) bool {
	return s.liveMongo(ctx)
}

func (s *Store) History(ctx context.Context, channelID string, limit int) ([]chatstore.Message, error) {
	if s.liveMongo(ctx) {
		return s.mongo.History(ctx, channelID, limit)
	}
	return s.mem.History(ctx, channelID, limit)
}

func (s *Store) Create(ctx context.Context, channelID, nickname, text, imageMime, imageData string) (chatstore.Message, error) {
	if s.liveMongo(ctx) {
		return s.mongo.Create(ctx, channelID, nickname, text, imageMime, imageData)
	}
	return s.mem.Create(ctx, channelID, nickname, text, imageMime, imageData)
}

func (s *Store) EditText(ctx context.Context, id, nickname, newText string) (chatstore.Message, bool, error) {
	if s.liveMongo(ctx) {
		return s.mongo.EditText(ctx, id, nickname, newText)
	}
	return s.mem.EditText(ctx, id, nickname, newText)
}

func (s *Store) Delete(ctx context.Context, id, nickname string) (bool, error) {
	if s.liveMongo(ctx) {
		return s.mongo.Delete(ctx, id, nickname)
	}
	return s.mem.Delete(ctx, id, nickname)
}

func (s *Store) ToggleReaction(ctx context.Context, id, emoji, nickname string) (map[string][]string, bool, error) {
	if s.liveMongo(ctx) {
		return s.mongo.ToggleReaction(ctx, id, emoji, nickname)
	}
	return s.mem.ToggleReaction(ctx, id, emoji, nickname)
}

