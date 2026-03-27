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
	text := strings.TrimSpace(asString(msg["text"]))
	if len([]rune(text)) > 500 {
		text = string([]rune(text)[:500])
	}
	img := normalizeIncomingImage(msg["image"])
	if text == "" && img == nil {
		h.emitServerLog("warn", "chat.rejected", "Rejected empty chat message.", sender.nickname, nil)
		h.sendMap(c, map[string]any{"type": "error", "message": "Пустое сообщение."})
		return
	}
	if msg["image"] != nil && img == nil {
		h.emitServerLog("warn", "chat.invalid_image", "Rejected invalid chat image payload.", sender.nickname, nil)
		h.sendMap(c, map[string]any{
			"type":    "error",
			"message": "Некорректное изображение (тип или размер). Разрешены JPEG, PNG, GIF, WebP, до ~1.8 МБ.",
		})
		return
	}

	go func() {
		m, err := h.getStore().Create(context.Background(), sender.nickname, text, opt(img, func(n *normalizedImage) string { return n.Mime }), opt(img, func(n *normalizedImage) string { return n.Data }))
		if err != nil {
			log.Printf("chat save: %v", err)
			h.emitServerLog("error", "chat.create_failed", "Failed to save chat message.", sender.nickname, map[string]string{"error": err.Error()})
			h.sendMap(c, map[string]any{"type": "error", "message": "Failed to save message."})
			return
		}
		h.emitServerLog("info", "chat.created", "Chat message saved.", sender.nickname, map[string]string{"messageId": m.ID, "channelId": sender.textChannel})
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
		h.emitServerLog("warn", "chat.edit_missing_id", "Chat edit rejected: message id missing.", sender.nickname, nil)
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
				h.emitServerLog("warn", "chat.edit_empty", "Chat edit rejected: empty result.", sender.nickname, map[string]string{"messageId": id})
				h.sendMap(c, map[string]any{"type": "error", "message": "Нельзя оставить сообщение без текста и без фото."})
				return
			}
			log.Printf("chat-edit: %v", err)
			h.emitServerLog("error", "chat.edit_failed", "Failed to edit chat message.", sender.nickname, map[string]string{"messageId": id, "error": err.Error()})
			h.sendMap(c, map[string]any{"type": "error", "message": "Не удалось изменить сообщение."})
			return
		}
		if !found {
			h.emitServerLog("warn", "chat.edit_missing", "Chat edit target not found.", sender.nickname, map[string]string{"messageId": id})
			h.sendMap(c, map[string]any{"type": "error", "message": "Сообщение не найдено."})
			return
		}
		h.emitServerLog("info", "chat.edited", "Chat message edited.", sender.nickname, map[string]string{"messageId": m.ID, "channelId": sender.textChannel})
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
		h.emitServerLog("warn", "chat.delete_missing_id", "Chat delete rejected: message id missing.", sender.nickname, nil)
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
			h.emitServerLog("error", "chat.delete_failed", "Failed to delete chat message.", sender.nickname, map[string]string{"messageId": id, "error": err.Error()})
			h.sendMap(c, map[string]any{"type": "error", "message": "Не удалось удалить сообщение."})
			return
		}
		if !ok {
			h.emitServerLog("warn", "chat.delete_missing", "Chat delete target not found.", sender.nickname, map[string]string{"messageId": id})
			h.sendMap(c, map[string]any{"type": "error", "message": "Сообщение не найдено."})
			return
		}
		h.emitServerLog("info", "chat.deleted", "Chat message deleted.", sender.nickname, map[string]string{"messageId": id, "channelId": sender.textChannel})
		h.broadcastToTextChannel(map[string]any{"type": "chat-message-deleted", "id": id, "channelId": sender.textChannel}, sender.textChannel, nil)
	}()
}

func (h *Hub) onChatReact(c *websocket.Conn, sender *client, msg map[string]any) {
	id := strings.TrimSpace(asString(msg["id"]))
	emoji := normalizeReactionEmoji(msg["emoji"])
	if id == "" || emoji == "" {
		h.emitServerLog("warn", "chat.react_invalid", "Chat reaction rejected: invalid id or emoji.", sender.nickname, nil)
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
			h.emitServerLog("error", "chat.react_failed", "Failed to toggle chat reaction.", sender.nickname, map[string]string{"messageId": id, "error": err.Error()})
			h.sendMap(c, map[string]any{"type": "error", "message": "Не удалось поставить реакцию."})
			return
		}
		if !found {
			h.emitServerLog("warn", "chat.react_missing", "Chat reaction target not found.", sender.nickname, map[string]string{"messageId": id})
			h.sendMap(c, map[string]any{"type": "error", "message": "Сообщение не найдено."})
			return
		}
		h.emitServerLog("info", "chat.reacted", "Chat reaction updated.", sender.nickname, map[string]string{"messageId": id, "channelId": sender.textChannel, "emoji": emoji})
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

