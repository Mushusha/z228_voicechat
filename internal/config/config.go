package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port               int
	HTTPSPort          int
	ListenHost         string
	MongoURI           string
	AdminPanelPassword string
	CertExtraIPs       string
	RTCIceServersJSON  string
	TURNURLs           string
	TURNUsername       string
	TURNCredential     string
	// RTCUseOpenRelay appends Metered Open Relay TURN (helps WebRTC over the public Internet).
	RTCUseOpenRelay bool
}

func Load() Config {
	return Config{
		Port:               envInt("PORT", 3000),
		HTTPSPort:          envHTTPSPort("HTTPS_PORT", 3443),
		ListenHost:         envString("LISTEN_HOST", "::"),
		MongoURI:           envString("MONGODB_URI", "mongodb://127.0.0.1:27017/zalupa228local"),
		AdminPanelPassword: envString("ADMIN_PANEL_PASSWORD", "admin123"),
		CertExtraIPs:       envString("CERT_EXTRA_IPS", ""),
		RTCIceServersJSON:  envString("RTC_ICE_SERVERS", ""),
		TURNURLs:           envString("TURN_URLS", ""),
		TURNUsername:       envString("TURN_USERNAME", ""),
		TURNCredential:     envString("TURN_CREDENTIAL", ""),
		RTCUseOpenRelay:    envBool("RTC_USE_OPEN_RELAY", true),
	}
}

func envBool(k string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(k)))
	if v == "" {
		return def
	}
	switch v {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return def
	}
}

func envString(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func envHTTPSPort(k string, def int) int {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	if v == "0" {
		return 0
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

