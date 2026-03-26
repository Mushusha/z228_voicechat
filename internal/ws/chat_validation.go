package ws

import (
	"regexp"
	"strings"
)

const (
	chatImageMaxB64 = 2_500_000
)

var (
	chatImageMimes = map[string]bool{
		"image/jpeg": true,
		"image/png":  true,
		"image/gif":  true,
		"image/webp": true,
	}
	reBase64 = regexp.MustCompile(`^[A-Za-z0-9+/]+=*$`)
	reObjID  = regexp.MustCompile(`^[a-fA-F0-9]{24}$`)
)

type normalizedImage struct {
	Mime string
	Data string
}

func normalizeIncomingImage(raw any) *normalizedImage {
	m, ok := raw.(map[string]any)
	if !ok || m == nil {
		return nil
	}
	mime := strings.ToLower(strings.TrimSpace(asString(m["mime"])))
	data := strings.TrimSpace(asString(m["data"]))
	data = strings.ReplaceAll(data, " ", "")
	data = strings.ReplaceAll(data, "\n", "")
	data = strings.ReplaceAll(data, "\r", "")
	data = strings.ReplaceAll(data, "\t", "")

	if strings.HasPrefix(strings.ToLower(data), "data:") {
		// data:<mime>;base64,<payload>
		if idx := strings.Index(data, ";base64,"); idx > 5 {
			mime0 := strings.ToLower(strings.TrimSpace(data[len("data:") : idx]))
			data0 := strings.TrimSpace(data[idx+len(";base64,"):])
			if mime0 != "" && data0 != "" {
				mime = mime0
				data = data0
			}
		}
	}

	if mime == "" || data == "" || !chatImageMimes[mime] {
		return nil
	}
	if len(data) > chatImageMaxB64 || len(data) < 32 {
		return nil
	}
	if !reBase64.MatchString(data) {
		return nil
	}
	return &normalizedImage{Mime: mime, Data: data}
}

func normalizeReactionEmoji(raw any) string {
	s := strings.TrimSpace(asString(raw))
	if s == "" || len([]rune(s)) > 16 {
		return ""
	}
	for _, r := range s {
		// block C0 controls except TAB/LF/CR (match Node regexp behavior)
		if r >= 0 && r <= 0x1F && r != '\t' && r != '\n' && r != '\r' {
			return ""
		}
	}
	return s
}

func isMongoObjectIdString(s string) bool {
	return reObjID.MatchString(s)
}

