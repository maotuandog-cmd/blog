package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBearerToken(t *testing.T) {
	if got := bearerToken("Bearer secret"); got != "secret" {
		t.Fatalf("got %q", got)
	}
	if got := bearerToken("bearer secret"); got != "secret" {
		t.Fatalf("case-insensitive got %q", got)
	}
	if got := bearerToken("Basic x"); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
}

func TestAuthDefaultDeny(t *testing.T) {
	g := &Gateway{APIToken: "", APIInsecure: false}
	h := g.auth(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/jobs/x", nil)
	h(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 got %d", rr.Code)
	}
}

func TestAuthInsecureAllows(t *testing.T) {
	g := &Gateway{APIToken: "", APIInsecure: true}
	h := g.auth(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/jobs/x", nil)
	h(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("want 200 got %d", rr.Code)
	}
}

func TestAuthTokenRequired(t *testing.T) {
	g := &Gateway{APIToken: "tok", APIInsecure: false}
	h := g.auth(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/jobs/x", nil)
	h(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 without token got %d", rr.Code)
	}

	rr2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet, "/v1/jobs/x", nil)
	req2.Header.Set("Authorization", "Bearer tok")
	h(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("want 200 with token got %d", rr2.Code)
	}
}
