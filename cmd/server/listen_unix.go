//go:build !windows

package main

import (
	"context"
	"net"
	"syscall"
)

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
