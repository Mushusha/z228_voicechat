package mongo

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"zalupa228local/internal/chatstore"
)

type Store struct {
	client *mongo.Client
	coll   *mongo.Collection
}

type doc struct {
	ID        primitive.ObjectID `bson:"_id,omitempty"`
	Nickname  string             `bson:"nickname"`
	Text      string             `bson:"text,omitempty"`
	ImageMime string             `bson:"imageMime,omitempty"`
	ImageData string             `bson:"imageData,omitempty"`
	Reactions map[string][]string `bson:"reactions,omitempty"`
	CreatedAt time.Time          `bson:"createdAt"`
	UpdatedAt time.Time          `bson:"updatedAt"`
}

func New(ctx context.Context, uri string) (*Store, error) {
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri).SetServerSelectionTimeout(8*time.Second))
	if err != nil {
		return nil, err
	}
	dbName := dbNameFromURI(uri)
	db := client.Database(dbName)
	coll := db.Collection("chatmessages")
	return &Store{client: client, coll: coll}, nil
}

func (s *Store) Ping(ctx context.Context) error {
	if s.client == nil {
		return errors.New("no client")
	}
	return s.client.Ping(ctx, nil)
}

func (s *Store) EnsureIndexes(ctx context.Context) error {
	_, err := s.coll.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "createdAt", Value: 1}},
	})
	return err
}

func (s *Store) History(ctx context.Context, limit int) ([]chatstore.Message, error) {
	if limit <= 0 {
		limit = 100
	}
	cur, err := s.coll.Find(ctx, bson.D{}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(int64(limit)))
	if err != nil {
		return nil, err
	}
	defer func() { _ = cur.Close(ctx) }()

	var docs []doc
	if err := cur.All(ctx, &docs); err != nil {
		return nil, err
	}
	// reverse to ascending createdAt, like Node
	out := make([]chatstore.Message, 0, len(docs))
	for i := len(docs) - 1; i >= 0; i-- {
		out = append(out, toMsg(docs[i]))
	}
	return out, nil
}

func (s *Store) Create(ctx context.Context, nickname, text, imageMime, imageData string) (chatstore.Message, error) {
	now := time.Now()
	d := doc{
		Nickname:  nickname,
		Text:      text,
		ImageMime: imageMime,
		ImageData: imageData,
		Reactions: map[string][]string{},
		CreatedAt: now,
		UpdatedAt: now,
	}
	res, err := s.coll.InsertOne(ctx, d)
	if err != nil {
		return chatstore.Message{}, err
	}
	oid, _ := res.InsertedID.(primitive.ObjectID)
	d.ID = oid
	return toMsg(d), nil
}

func (s *Store) EditText(ctx context.Context, id, nickname, newText string) (chatstore.Message, bool, error) {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return chatstore.Message{}, false, nil
	}
	var cur doc
	if err := s.coll.FindOne(ctx, bson.D{{Key: "_id", Value: oid}, {Key: "nickname", Value: nickname}}).Decode(&cur); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return chatstore.Message{}, false, nil
		}
		return chatstore.Message{}, false, err
	}
	if strings.TrimSpace(newText) == "" && cur.ImageMime == "" {
		return chatstore.Message{}, true, chatstore.ErrEmptyAfterEdit
	}

	var out doc
	err = s.coll.FindOneAndUpdate(
		ctx,
		bson.D{{Key: "_id", Value: oid}, {Key: "nickname", Value: nickname}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "text", Value: newText}, {Key: "updatedAt", Value: time.Now()}}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&out)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return chatstore.Message{}, false, nil
		}
		return chatstore.Message{}, false, err
	}
	return toMsg(out), true, nil
}

func (s *Store) Delete(ctx context.Context, id, nickname string) (bool, error) {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return false, nil
	}
	res, err := s.coll.DeleteOne(ctx, bson.D{{Key: "_id", Value: oid}, {Key: "nickname", Value: nickname}})
	if err != nil {
		return false, err
	}
	return res.DeletedCount > 0, nil
}

func (s *Store) ToggleReaction(ctx context.Context, id, emoji, nickname string) (map[string][]string, bool, error) {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, false, nil
	}
	var out doc
	if err := s.coll.FindOne(ctx, bson.D{{Key: "_id", Value: oid}}).Decode(&out); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, false, nil
		}
		return nil, false, err
	}
	if out.Reactions == nil {
		out.Reactions = map[string][]string{}
	}
	toggleReactionOnStore(out.Reactions, emoji, nickname)
	_, err = s.coll.UpdateByID(ctx, oid, bson.D{
		{Key: "$set", Value: bson.D{
			{Key: "reactions", Value: out.Reactions},
			{Key: "updatedAt", Value: time.Now()},
		}},
	})
	if err != nil {
		return nil, false, err
	}
	return cloneReactions(out.Reactions), true, nil
}

func toMsg(d doc) chatstore.Message {
	return chatstore.Message{
		ID:        d.ID.Hex(),
		Nickname:  d.Nickname,
		Text:      d.Text,
		ImageMime: d.ImageMime,
		ImageData: d.ImageData,
		Reactions: cloneReactions(d.Reactions),
		CreatedAt: d.CreatedAt,
	}
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
	if in == nil {
		return map[string][]string{}
	}
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

func dbNameFromURI(uri string) string {
	const def = "zalupa228local"
	u, err := url.Parse(uri)
	if err != nil {
		return def
	}
	p := strings.Trim(u.Path, "/")
	if p == "" {
		return def
	}
	if strings.Contains(p, "/") {
		parts := strings.Split(p, "/")
		p = parts[len(parts)-1]
	}
	return p
}

