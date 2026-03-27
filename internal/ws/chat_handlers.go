package ws

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"zalupa228local/internal/chatstore"
)

func (h *Hub) onChat(c *websocket.Conn, sender *client, msg map[string]any) {
	if sender.textChannel == "" {
		h.sendMap(c, map[string]any{"type": "error", "message": "Сначала войдите в текстовый канал."})
		return
	}
	text := strings.TrimSpace(asString(msg["text"]))
	if len([]rune(text)) > 500 {
		text = string([]rune(text)[:500])
	}
	img := normalizeIncomingImage(msg["image"])
	if text == "" && img == nil {
		h.sendMap(c, map[string]any{"type": "error", "message": "Пустое сообщение."})
		return
	}
	if msg["image"] != nil && img == nil {
		h.sendMap(c, map[string]any{
			"type":    "error",
			"message": "Некорректное изображение (тип или размер). Разрешены JPEG, PNG, GIF, WebP, до ~1.8 МБ.",
		})
		return
	}

	go func() {
		m, err := h.getStore().Create(context.Background(), sender.textChannel, sender.nickname, text, opt(img, func(n *normalizedImage) string { return n.Mime }), opt(img, func(n *normalizedImage) string { return n.Data }))
		if err != nil {
			log.Printf("chat save: %v", err)
			h.sendMap(c, map[string]any{"type": "error", "message": "Failed to save message."})
			return
		}
		payload := map[string]any{
			"type":      "chat-message",
			"id":        m.ID,
			"nickname":  sender.nickname,
			"text":      m.Text,
			"createdAt": m.CreatedAt.UTC().Format(time.RFC3339Nano),
			"reactions": map[string][]string{},
			"channelId": sender.textChannel,
		}
		if m.ImageMime != "" && m.ImageData != "" {
			payload["imageMime"] = m.ImageMime
			payload["imageData"] = m.ImageData
		}
		h.broadcastToTextChannel(payload, sender.textChannel, nil)
	}()
}

func (h *Hub) onChatEdit(c *websocket.Conn, sender *client, msg map[string]any) {
	id := strings.TrimSpace(asString(msg["id"]))
	newText := strings.TrimSpace(asString(msg["text"]))
	if len([]rune(newText)) > 500 {
		newText = string([]rune(newText)[:500])
	}
	if id == "" {
		h.sendMap(c, map[string]any{"type": "error", "message": "Нет id сообщения."})
		return
	}

	go func() {
		if isMongoObjectIdString(id) && !h.isMongoLive(context.Background()) {
			h.sendMap(c, map[string]any{
				"type":    "error",
				"message": "База данных недоступна. Перезапустите сервер (или docker compose up).",
			})
			return
		}

		m, found, err := h.getStore().EditText(context.Background(), id, sender.nickname, newText)
		if err != nil {
			if err == chatstore.ErrEmptyAfterEdit {
				h.sendMap(c, map[string]any{"type": "error", "message": "Нельзя оставить сообщение без текста и без фото."})
				return
			}
			log.Printf("chat-edit: %v", err)
			h.sendMap(c, map[string]any{"type": "error", "message": "Не удалось изменить сообщение."})
			return
		}
		if !found {
			h.sendMap(c, map[string]any{"type": "error", "message": "Сообщение не найдено."})
			return
		}
		payload := map[string]any{
			"type":      "chat-message-updated",
			"id":        m.ID,
			"nickname":  m.Nickname,
			"text":      m.Text,
			"createdAt": m.CreatedAt.UTC().Format(time.RFC3339Nano),
			"reactions": m.Reactions,
			"channelId": sender.textChannel,
		}
		if m.ImageMime != "" && m.ImageData != "" {
			payload["imageMime"] = m.ImageMime
			payload["imageData"] = m.ImageData
		}
		h.broadcastToTextChannel(payload, sender.textChannel, nil)
	}()
}

func (h *Hub) onChatDelete(c *websocket.Conn, sender *client, msg map[string]any) {
	id := strings.TrimSpace(asString(msg["id"]))
	if id == "" {
		h.sendMap(c, map[string]any{"type": "error", "message": "Нет id сообщения."})
		return
	}
	go func() {
		if isMongoObjectIdString(id) && !h.isMongoLive(context.Background()) {
			h.sendMap(c, map[string]any{
				"type":    "error",
				"message": "База данных недоступна. Перезапустите сервер (или docker compose up).",
			})
			return
		}
		ok, err := h.getStore().Delete(context.Background(), id, sender.nickname)
		if err != nil {
			log.Printf("chat-delete: %v", err)
			h.sendMap(c, map[string]any{"type": "error", "message": "Не удалось удалить сообщение."})
			return
		}
		if !ok {
			h.sendMap(c, map[string]any{"type": "error", "message": "Сообщение не найдено."})
			return
		}
		h.broadcastToTextChannel(map[string]any{"type": "chat-message-deleted", "id": id, "channelId": sender.textChannel}, sender.textChannel, nil)
	}()
}

func (h *Hub) onChatReact(c *websocket.Conn, sender *client, msg map[string]any) {
	id := strings.TrimSpace(asString(msg["id"]))
	emoji := normalizeReactionEmoji(msg["emoji"])
	if id == "" || emoji == "" {
		h.sendMap(c, map[string]any{"type": "error", "message": "Нужны id сообщения и реакция."})
		return
	}
	go func() {
		if isMongoObjectIdString(id) && !h.isMongoLive(context.Background()) {
			h.sendMap(c, map[string]any{
				"type":    "error",
				"message": "База данных недоступна. Перезапустите сервер (или docker compose up).",
			})
			return
		}
		r, found, err := h.getStore().ToggleReaction(context.Background(), id, emoji, sender.nickname)
		if err != nil {
			log.Printf("chat-react: %v", err)
			h.sendMap(c, map[string]any{"type": "error", "message": "Не удалось поставить реакцию."})
			return
		}
		if !found {
			h.sendMap(c, map[string]any{"type": "error", "message": "Сообщение не найдено."})
			return
		}
		h.broadcastToTextChannel(map[string]any{"type": "chat-message-reactions", "id": id, "reactions": r, "channelId": sender.textChannel}, sender.textChannel, nil)
	}()
}

func (h *Hub) isMongoLive(ctx context.Context) bool {
	type liveMongo interface {
		LiveMongo(ctx context.Context) bool
	}
	if s, ok := h.getStore().(liveMongo); ok {
		return s.LiveMongo(ctx)
	}
	return false
}

func opt[T any](p *T, f func(*T) string) string {
	if p == nil {
		return ""
	}
	return f(p)
}

