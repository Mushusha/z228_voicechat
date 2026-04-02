package lk

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/livekit/protocol/auth"
)

var roomNamePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

// SanitizeRoomName maps a voice channel id to a LiveKit room name (must match server rules).
func SanitizeRoomName(voiceChannelID string) (string, error) {
	s := strings.TrimSpace(voiceChannelID)
	if s == "" || !roomNamePattern.MatchString(s) {
		return "", fmt.Errorf("invalid voice channel id for LiveKit room")
	}
	return s, nil
}

// AccessToken mints a JWT for joining a LiveKit room as a voice participant.
func AccessToken(apiKey, apiSecret, room, identity, displayName string) (string, error) {
	if apiKey == "" || apiSecret == "" {
		return "", fmt.Errorf("missing LiveKit API credentials")
	}
	if identity == "" {
		return "", fmt.Errorf("missing identity")
	}
	at := auth.NewAccessToken(apiKey, apiSecret)
	grant := &auth.VideoGrant{
		RoomJoin: true,
		Room:     room,
	}
	at.SetVideoGrant(grant).
		SetIdentity(identity).
		SetValidFor(6 * time.Hour)
	if displayName != "" {
		at.SetName(displayName)
	}
	return at.ToJWT()
}
