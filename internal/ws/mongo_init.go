package ws

import (
	"context"
	"time"

	autostore "zalupa228local/internal/chatstore/auto"
	memstore "zalupa228local/internal/chatstore/memory"
)

func (h *Hub) InitMongoAsync() {
	// Do not block WebSocket handshake. Node version sends "hello" immediately.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		mem, _ := h.getStore().(*memstore.Store)
		s := autostore.New(ctx, h.opts.MongoURI, mem)
		h.setStore(s)
	}()
}

