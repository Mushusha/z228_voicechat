package ws

type HelloPayload struct {
	Type           string `json:"type"`
	AdminPanel     bool   `json:"adminPanel"`
	ChatMessageOps bool   `json:"chatMessageOps"`
	// LiveKitURL is the WebSocket URL clients pass to LiveKit (empty = voice not using LiveKit).
	LiveKitURL string `json:"liveKitUrl,omitempty"`
}

type ChatChannel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

