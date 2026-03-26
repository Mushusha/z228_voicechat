package ws

import (
	"strings"

	"golang.org/x/text/unicode/norm"
)

func normalizeWsMessageType(raw any) string {
	s := strings.ToLower(strings.TrimSpace(asString(raw)))
	if s == "" {
		return ""
	}
	s = norm.NFKC.String(s)
	s = strings.Map(func(r rune) rune {
		switch {
		// zero-width characters
		case r >= 0x200B && r <= 0x200D:
			return -1
		case r == 0x2060 || r == 0xFEFF:
			return -1
		// typographic hyphens → ASCII
		case r >= 0x2010 && r <= 0x2015:
			return '-'
		case r == 0x2212 || r == 0xFE58 || r == 0xFE63 || r == 0xFF0D:
			return '-'
		default:
			return r
		}
	}, s)
	s = strings.TrimSpace(s)
	return s
}

