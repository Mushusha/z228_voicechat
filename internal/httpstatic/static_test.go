package httpstatic

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestHandlerSetsNoStoreForHTMLAndJS(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app.js"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}

	h := Handler(dir)
	for _, path := range []string{"/index.html", "/app.js"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if got := rec.Header().Get("Cache-Control"); got == "" {
			t.Fatalf("%s Cache-Control empty", path)
		}
	}
}
