package ws

type HelloPayload struct {
	Type           string `json:"type"`
	AdminPanel     bool   `json:"adminPanel"`
	ChatMessageOps bool   `json:"chatMessageOps"`
	ServerLogs     bool   `json:"serverLogs"`
}

type ChatChannel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

