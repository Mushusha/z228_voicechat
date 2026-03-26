package cert

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"os"
	"strings"
	"time"
)

type Credentials struct {
	CertPEM []byte
	KeyPEM  []byte
}

func SelfSigned(commonName string, extraIPsCSV string) (Credentials, error) {
	ips, err := localIPv4s()
	if err != nil {
		return Credentials{}, err
	}
	for _, s := range splitCSV(extraIPsCSV) {
		if ip := net.ParseIP(s); ip != nil {
			ips = appendIfMissingIP(ips, ip)
		}
	}

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return Credentials{}, err
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return Credentials{}, err
	}

	now := time.Now()
	tpl := x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName: commonName,
		},
		NotBefore:             now.Add(-5 * time.Minute),
		NotAfter:              now.Add(365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           ips,
	}

	der, err := x509.CreateCertificate(rand.Reader, &tpl, &tpl, &key.PublicKey, key)
	if err != nil {
		return Credentials{}, err
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if certPEM == nil {
		return Credentials{}, errors.New("failed to PEM-encode certificate")
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	if keyPEM == nil {
		return Credentials{}, errors.New("failed to PEM-encode key")
	}

	return Credentials{CertPEM: certPEM, KeyPEM: keyPEM}, nil
}

func localIPv4s() ([]net.IP, error) {
	var out []net.IP
	out = append(out, net.ParseIP("127.0.0.1"))

	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	for _, iface := range ifaces {
		if (iface.Flags & net.FlagUp) == 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil {
				continue
			}
			ip4 := ip.To4()
			if ip4 == nil {
				continue
			}
			if ip4.IsLoopback() {
				continue
			}
			out = appendIfMissingIP(out, ip4)
		}
	}
	return out, nil
}

func appendIfMissingIP(xs []net.IP, ip net.IP) []net.IP {
	for _, x := range xs {
		if x.Equal(ip) {
			return xs
		}
	}
	return append(xs, ip)
}

func splitCSV(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		p := strings.TrimSpace(part)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// Ensure imported packages not optimized away on old toolchains.
var _ = os.ErrNotExist

