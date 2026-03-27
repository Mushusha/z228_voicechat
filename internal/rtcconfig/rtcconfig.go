package rtcconfig

import (
	"encoding/json"
	"log"
	"strings"
)

// DefaultSTUN returns the same STUN entries the browser client used historically.
func DefaultSTUN() []map[string]any {
	return []map[string]any{
		{"urls": "stun:stun.l.google.com:19302"},
		{"urls": "stun:stun1.l.google.com:19302"},
	}
}

// OpenRelayMetered is a no-auth Metered Open Relay project endpoint (public, best-effort).
// For production, prefer self-hosted TURN (TURN_URLS / coturn).
var OpenRelayMetered = map[string]any{
	"urls": []string{
		"turn:openrelay.metered.ca:80",
		"turn:openrelay.metered.ca:443",
		"turn:openrelay.metered.ca:443?transport=tcp",
	},
	"username":   "openrelayproject",
	"credential": "openrelayproject",
}

// BuildIceServers merges default STUN with optional public relay, dedicated TURN, and JSON extras.
func BuildIceServers(extraJSON, turnURLs, turnUser, turnCred string, useOpenRelay bool) []map[string]any {
	out := append([]map[string]any(nil), DefaultSTUN()...)

	if useOpenRelay {
		out = append(out, OpenRelayMetered)
	}

	if turnURLs != "" && turnUser != "" && turnCred != "" {
		urls := splitURLs(turnURLs)
		if len(urls) > 0 {
			out = append(out, map[string]any{
				"urls":       urls,
				"username":   turnUser,
				"credential": turnCred,
			})
		}
	}

	if extraJSON != "" {
		var extra []map[string]any
		if err := json.Unmarshal([]byte(extraJSON), &extra); err != nil {
			log.Printf("rtc: RTC_ICE_SERVERS JSON parse error: %v", err)
		} else {
			out = append(out, extra...)
		}
	}

	return out
}

func splitURLs(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
