package config

import "testing"

func TestLoadUsesDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("HTTPS_PORT", "")
	t.Setenv("LISTEN_HOST", "")
	t.Setenv("MONGODB_URI", "")
	t.Setenv("ADMIN_PANEL_PASSWORD", "")
	t.Setenv("SERVER_LOG_STREAM", "")

	cfg := Load()

	if cfg.Port != 3000 {
		t.Fatalf("Port = %d, want 3000", cfg.Port)
	}
	if cfg.HTTPSPort != 3443 {
		t.Fatalf("HTTPSPort = %d, want 3443", cfg.HTTPSPort)
	}
	if cfg.ListenHost != "::" {
		t.Fatalf("ListenHost = %q, want ::", cfg.ListenHost)
	}
	if cfg.AdminPanelPassword != "admin123" {
		t.Fatalf("AdminPanelPassword = %q", cfg.AdminPanelPassword)
	}
	if cfg.ServerLogStream {
		t.Fatal("ServerLogStream = true, want false by default")
	}
}

func TestLoadReadsEnvValues(t *testing.T) {
	t.Setenv("PORT", "3100")
	t.Setenv("HTTPS_PORT", "0")
	t.Setenv("LISTEN_HOST", "0.0.0.0")
	t.Setenv("MONGODB_URI", "mongodb://mongo/test")
	t.Setenv("ADMIN_PANEL_PASSWORD", "secret")
	t.Setenv("SERVER_LOG_STREAM", "1")

	cfg := Load()

	if cfg.Port != 3100 {
		t.Fatalf("Port = %d, want 3100", cfg.Port)
	}
	if cfg.HTTPSPort != 0 {
		t.Fatalf("HTTPSPort = %d, want 0", cfg.HTTPSPort)
	}
	if cfg.ListenHost != "0.0.0.0" {
		t.Fatalf("ListenHost = %q", cfg.ListenHost)
	}
	if cfg.MongoURI != "mongodb://mongo/test" {
		t.Fatalf("MongoURI = %q", cfg.MongoURI)
	}
	if cfg.AdminPanelPassword != "secret" {
		t.Fatalf("AdminPanelPassword = %q", cfg.AdminPanelPassword)
	}
	if !cfg.ServerLogStream {
		t.Fatal("ServerLogStream = false, want true")
	}
}
