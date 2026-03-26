package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

func main() {
	url := "ws://127.0.0.1:3000"
	c, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		log.Fatal(err)
	}
	defer c.Close()

	readMsg := func(timeout time.Duration) (map[string]any, error) {
		_ = c.SetReadDeadline(time.Now().Add(timeout))
		_, b, err := c.ReadMessage()
		if err != nil {
			return nil, err
		}
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			return nil, err
		}
		return m, nil
	}

	hello, err := readMsg(2 * time.Second)
	if err != nil {
		log.Fatal("read hello:", err)
	}
	fmt.Println("hello:", hello["type"])

	if err := c.WriteJSON(map[string]any{"type": "join", "nickname": "tester"}); err != nil {
		log.Fatal(err)
	}

	seenJoin := false
	seenHistory := false
	for i := 0; i < 8; i++ {
		m, err := readMsg(2 * time.Second)
		if err != nil {
			log.Fatal("waiting join/history:", err)
		}
		fmt.Println("msg:", m["type"])
		if m["type"] == "join-accepted" {
			seenJoin = true
		}
		if m["type"] == "chat-history" {
			seenHistory = true
			break
		}
	}
	if !seenJoin || !seenHistory {
		log.Fatal("did not see join-accepted + chat-history")
	}

	// chat -> wait chat-message to get id
	text := "smoke-" + time.Now().Format("150405")
	if err := c.WriteJSON(map[string]any{"type": "chat", "text": text}); err != nil {
		log.Fatal(err)
	}
	var msgID string
	for i := 0; i < 8; i++ {
		m, err := readMsg(2 * time.Second)
		if err != nil {
			log.Fatal("waiting chat-message:", err)
		}
		t, _ := m["type"].(string)
		if t != "chat-message" {
			continue
		}
		if strings.TrimSpace(fmt.Sprint(m["text"])) == text {
			msgID = fmt.Sprint(m["id"])
			fmt.Println("chat-message id:", msgID)
			break
		}
	}
	if msgID == "" {
		log.Fatal("did not receive own chat-message")
	}

	// react
	if err := c.WriteJSON(map[string]any{"type": "chat-react", "id": msgID, "emoji": "👍"}); err != nil {
		log.Fatal(err)
	}
	if _, err := waitType(readMsg, "chat-message-reactions", 2*time.Second); err != nil {
		log.Fatal(err)
	}
	fmt.Println("reactions: ok")

	// edit
	if err := c.WriteJSON(map[string]any{"type": "chat-edit", "id": msgID, "text": text + "-edit"}); err != nil {
		log.Fatal(err)
	}
	if _, err := waitType(readMsg, "chat-message-updated", 2*time.Second); err != nil {
		log.Fatal(err)
	}
	fmt.Println("edit: ok")

	// delete
	if err := c.WriteJSON(map[string]any{"type": "chat-delete", "id": msgID}); err != nil {
		log.Fatal(err)
	}
	if _, err := waitType(readMsg, "chat-message-deleted", 2*time.Second); err != nil {
		log.Fatal(err)
	}
	fmt.Println("delete: ok")
}

func waitType(readMsg func(time.Duration) (map[string]any, error), want string, perReadTimeout time.Duration) (map[string]any, error) {
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		m, err := readMsg(perReadTimeout)
		if err != nil {
			if errors.Is(err, websocket.ErrCloseSent) {
				return nil, err
			}
			// keep waiting on timeouts
			if strings.Contains(err.Error(), "i/o timeout") {
				continue
			}
			return nil, err
		}
		if fmt.Sprint(m["type"]) == want {
			return m, nil
		}
	}
	return nil, fmt.Errorf("timeout waiting for %s", want)
}

