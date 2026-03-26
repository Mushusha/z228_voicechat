package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port              int
	HTTPSPort         int
	ListenHost        string
	MongoURI          string
	AdminPanelPassword string
	CertExtraIPs      string
}

func Load() Config {
	return Config{
		Port:              envInt("PORT", 3000),
		HTTPSPort:         envHTTPSPort("HTTPS_PORT", 3443),
		ListenHost:        envString("LISTEN_HOST", "::"),
		MongoURI:          envString("MONGODB_URI", "mongodb://127.0.0.1:27017/zalupa228local"),
		AdminPanelPassword: envString("ADMIN_PANEL_PASSWORD", "admin123"),
		CertExtraIPs:      envString("CERT_EXTRA_IPS", ""),
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

