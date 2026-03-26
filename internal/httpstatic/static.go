package httpstatic

import (
	"net/http"
	"path/filepath"
	"strings"
)

func Handler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ext := strings.ToLower(filepath.Ext(r.URL.Path))
		if ext == ".html" || ext == ".js" || strings.HasSuffix(strings.ToLower(r.URL.Path), ".html") {
			w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
		}
		fs.ServeHTTP(w, r)
	})
}

