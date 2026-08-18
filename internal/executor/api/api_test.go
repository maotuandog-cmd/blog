package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jpsoft/hermes/internal/task"
)

func TestAPITimingMetrics(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(20 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	ex := New()
	payload, _ := json.Marshal(task.APIPayload{
		Request: task.APIRequest{
			Method:       http.MethodGet,
			URL:          srv.URL,
			ExpectStatus: []int{200},
		},
	})
	job := &task.Job{Protocol: task.ProtocolAPI, Payload: payload}
	res, err := ex.Execute(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Success {
		t.Fatalf("want success: %+v", res)
	}
	if res.Metrics["hermes_api_total_ms"] <= 0 {
		t.Fatalf("missing total: %+v", res.Metrics)
	}
	if res.Metrics["hermes_api_ttfb_ms"] < 0 {
		t.Fatalf("ttfb should be set: %+v", res.Metrics)
	}
	// D01: with DisableKeepAlives, connect should be observed on httptest
	if res.Metrics["hermes_api_connect_ms"] < 0 {
		t.Fatalf("connect should be set with DisableKeepAlives: %+v", res.Metrics)
	}
	if res.Extra["timing"] == nil {
		t.Fatal("extra.timing missing")
	}
	if !strings.Contains(res.Steps[0].Output, "ttfb=") {
		t.Fatalf("step output missing timing: %s", res.Steps[0].Output)
	}
}

func TestAPIAuthCookieJar(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "sid", Value: "abc", Path: "/"})
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/me", func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("sid")
		if err != nil || c.Value != "abc" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`ok`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	ex := New()
	payload, _ := json.Marshal(task.APIPayload{
		Auth: &task.APIRequest{Method: http.MethodGet, URL: srv.URL + "/login", ExpectStatus: []int{200}},
		Request: task.APIRequest{Method: http.MethodGet, URL: srv.URL + "/me", ExpectStatus: []int{200}, ExpectContains: "ok"},
	})
	res, err := ex.Execute(context.Background(), &task.Job{Protocol: task.ProtocolAPI, Payload: payload})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Success {
		t.Fatalf("cookie jar auth chain failed: %+v", res)
	}
}
