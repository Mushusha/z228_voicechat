package main

import (
	"context"
	"crypto/tls"
	"log"
	"net"
	"net/http"
	"path/filepath"
	"syscall"
	"time"

	"zalupa228local/internal/cert"
	"zalupa228local/internal/config"
	"zalupa228local/internal/httpstatic"
	"zalupa228local/internal/ws"
)

func main() {
	cfg := config.Load()

	publicDir := filepath.Join("server", "public")

	hub := ws.NewHub(ws.HubOptions{
		AdminPanelPassword: cfg.AdminPanelPassword,
		MongoURI:           cfg.MongoURI,
	})
	hub.InitMongoAsync()

	staticHandler := httpstatic.Handler(publicDir)
	handler := ws.WithWebSocketFallback(hub, staticHandler)

	httpSrv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("HTTP: http://127.0.0.1:%d — listening %s", cfg.Port, cfg.ListenHost)
		log.Printf("WebSocket: join, chat, chat-edit, chat-delete, chat-react, signal, admin-verify, admin-peers, admin-kick")
		ln, err := listenTCP(cfg.ListenHost, cfg.Port)
		if err != nil {
			log.Fatalf("HTTP listen: %v", err)
		}
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	if cfg.HTTPSPort > 0 {
		creds, err := cert.SelfSigned("zalupa228local", cfg.CertExtraIPs)
		if err != nil {
			log.Fatalf("self-signed cert: %v", err)
		}
		certPair, err := tls.X509KeyPair(creds.CertPEM, creds.KeyPEM)
		if err != nil {
			log.Fatalf("tls key pair: %v", err)
		}

		httpsSrv := &http.Server{
			Handler:           handler,
			ReadHeaderTimeout: 10 * time.Second,
			TLSConfig: &tls.Config{
				Certificates: []tls.Certificate{certPair},
			},
		}

		go func() {
			log.Printf("HTTPS: https://127.0.0.1:%d — same port from LAN / Docker", cfg.HTTPSPort)
			log.Printf("Open https://<this-pc-ip>:%d on other devices; accept the self-signed cert once.", cfg.HTTPSPort)
			ln, err := listenTCP(cfg.ListenHost, cfg.HTTPSPort)
			if err != nil {
				log.Fatalf("HTTPS listen: %v", err)
			}
			tlsLn := tls.NewListener(ln, httpsSrv.TLSConfig)
			if err := httpsSrv.Serve(tlsLn); err != nil && err != http.ErrServerClosed {
				log.Fatalf("HTTPS server error: %v", err)
			}
		}()
	}

	select {}
	// graceful shutdown could be added later
	_ = httpSrv.Shutdown(context.Background())
}

func listenTCP(host string, port int) (net.Listener, error) {
	addr := net.JoinHostPort(host, itoa(port))
	lc := net.ListenConfig{}
	if host == "::" {
		lc.Control = func(network, address string, c syscall.RawConn) error {
			var ctrlErr error
			if err := c.Control(func(fd uintptr) {
				ctrlErr = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IPV6, syscall.IPV6_V6ONLY, 0)
			}); err != nil {
				return err
			}
			return ctrlErr
		}
	}
	return lc.Listen(context.Background(), "tcp", addr)
}

func itoa(n int) string {
	// avoid importing strconv in main; tiny helper
	if n == 0 {
		return "0"
	}
	var b [32]byte
	i := len(b)
	x := n
	for x > 0 {
		i--
		b[i] = byte('0' + x%10)
		x /= 10
	}
	return string(b[i:])
}

