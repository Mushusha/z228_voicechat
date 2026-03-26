package ws

type HelloPayload struct {
	Type           string `json:"type"`
	AdminPanel     bool   `json:"adminPanel"`
	ChatMessageOps bool   `json:"chatMessageOps"`
}

