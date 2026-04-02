package config

import (
	"net/url"
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

	// LiveKit (voice SFU). Public URL is what browsers use (e.g. wss://lk.example.com or ws://localhost:7880).
	LiveKitPublicURL string
	LiveKitAPIKey    string
	LiveKitAPISecret string
}

func Load() Config {
	lkURL := strings.TrimSpace(envString("LIVEKIT_PUBLIC_URL", ""))
	return Config{
		Port:               envInt("PORT", 3000),
		HTTPSPort:          envHTTPSPort("HTTPS_PORT", 3443),
		ListenHost:         envString("LISTEN_HOST", "::"),
		MongoURI:           envString("MONGODB_URI", "mongodb://127.0.0.1:27017/zalupa228local"),
		AdminPanelPassword: envString("ADMIN_PANEL_PASSWORD", "admin123"),
		CertExtraIPs:       mergeCertExtraSAN(envString("CERT_EXTRA_IPS", ""), lkURL),
		LiveKitPublicURL:   lkURL,
		LiveKitAPIKey:      strings.TrimSpace(envString("LIVEKIT_API_KEY", "")),
		LiveKitAPISecret:   strings.TrimSpace(envString("LIVEKIT_API_SECRET", "")),
	}
}

// mergeCertExtraSAN joins CERT_EXTRA_IPS with the host from LIVEKIT_PUBLIC_URL (IP or DNS)
// so the self-signed HTTPS cert matches the same host friends use for wss / the page.
func mergeCertExtraSAN(certEnv, liveKitURL string) string {
	seen := make(map[string]struct{})
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		k := strings.ToLower(s)
		if _, ok := seen[k]; ok {
			return
		}
		seen[k] = struct{}{}
		out = append(out, s)
	}
	for _, s := range strings.Split(certEnv, ",") {
		add(s)
	}
	if u, err := url.Parse(liveKitURL); err == nil && u.Host != "" {
		add(u.Hostname())
	}
	return strings.Join(out, ",")
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

