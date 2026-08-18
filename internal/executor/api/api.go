package api

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptrace"
	"strings"
	"sync"
	"time"

	"github.com/jpsoft/hermes/internal/task"
)

// Executor runs HTTP probes with per-job CookieJar and DisableKeepAlives
// so DNS/Connect/TLS timings are observable (D01/D05).
type Executor struct {
	timeout time.Duration
}

func New() *Executor {
	return &Executor{timeout: 60 * time.Second}
}

func (e *Executor) Protocol() task.Protocol { return task.ProtocolAPI }

func (e *Executor) newClient() *http.Client {
	jar, _ := cookiejar.New(nil)
	tr := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 0}).DialContext,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          0,
		DisableKeepAlives:     true, // D01: ensure httptrace DNS/Connect/TLS fire each probe
		TLSHandshakeTimeout:   15 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return &http.Client{
		Timeout:   e.timeout,
		Jar:       jar,
		Transport: tr,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}
}

func (e *Executor) Execute(ctx context.Context, job *task.Job) (*task.Result, error) {
	var p task.APIPayload
	if err := json.Unmarshal(job.Payload, &p); err != nil {
		return &task.Result{Success: false, Message: "invalid api payload: " + err.Error()}, nil
	}

	client := e.newClient()
	start := time.Now()
	var steps []task.StepResult
	var authTimings map[string]float64

	if p.Auth != nil {
		st, tm, err := e.doRequest(ctx, client, "auth", *p.Auth)
		steps = append(steps, st)
		authTimings = tm
		if err != nil || !st.Success {
			return &task.Result{
				Success:    false,
				Message:    "auth failed",
				Steps:      steps,
				DurationMs: time.Since(start).Milliseconds(),
				Metrics:    prefixMetrics("auth_", tm),
				Extra:      map[string]interface{}{"authTiming": tm},
			}, nil
		}
	}

	st, tm, err := e.doRequest(ctx, client, "request", p.Request)
	steps = append(steps, st)
	ok := err == nil && st.Success

	metrics := prefixMetrics("", tm)
	metrics["hermes_api_duration_ms"] = float64(st.DurationMs)
	if authTimings != nil {
		for k, v := range prefixMetrics("auth_", authTimings) {
			metrics[k] = v
		}
	}

	extra := map[string]interface{}{"timing": tm}
	if authTimings != nil {
		extra["authTiming"] = authTimings
	}

	return &task.Result{
		Success:    ok,
		Message:    ternary(ok, "ok", st.Error),
		Steps:      steps,
		DurationMs: time.Since(start).Milliseconds(),
		Metrics:    metrics,
		Extra:      extra,
	}, nil
}

type probeTiming struct {
	mu sync.Mutex

	dnsStart, dnsDone         time.Time
	connectStart, connectDone time.Time
	tlsStart, tlsDone         time.Time
	gotConn                   time.Time
	firstByte                 time.Time
	start                     time.Time
}

func (t *probeTiming) trace() *httptrace.ClientTrace {
	return &httptrace.ClientTrace{
		DNSStart: func(httptrace.DNSStartInfo) {
			t.mu.Lock()
			t.dnsStart = time.Now()
			t.mu.Unlock()
		},
		DNSDone: func(httptrace.DNSDoneInfo) {
			t.mu.Lock()
			t.dnsDone = time.Now()
			t.mu.Unlock()
		},
		ConnectStart: func(_, _ string) {
			t.mu.Lock()
			t.connectStart = time.Now()
			t.mu.Unlock()
		},
		ConnectDone: func(_, _ string, _ error) {
			t.mu.Lock()
			t.connectDone = time.Now()
			t.mu.Unlock()
		},
		TLSHandshakeStart: func() {
			t.mu.Lock()
			t.tlsStart = time.Now()
			t.mu.Unlock()
		},
		TLSHandshakeDone: func(_ tls.ConnectionState, _ error) {
			t.mu.Lock()
			t.tlsDone = time.Now()
			t.mu.Unlock()
		},
		GotConn: func(httptrace.GotConnInfo) {
			t.mu.Lock()
			t.gotConn = time.Now()
			t.mu.Unlock()
		},
		GotFirstResponseByte: func() {
			t.mu.Lock()
			t.firstByte = time.Now()
			t.mu.Unlock()
		},
	}
}

func (t *probeTiming) metrics(totalMs int64) map[string]float64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	ms := func(a, b time.Time) float64 {
		if a.IsZero() || b.IsZero() || b.Before(a) {
			return -1
		}
		return float64(b.Sub(a).Milliseconds())
	}
	out := map[string]float64{
		"hermes_api_dns_ms":     ms(t.dnsStart, t.dnsDone),
		"hermes_api_connect_ms": ms(t.connectStart, t.connectDone),
		"hermes_api_tls_ms":     ms(t.tlsStart, t.tlsDone),
		"hermes_api_ttfb_ms":    -1,
		"hermes_api_total_ms":   float64(totalMs),
	}
	if !t.start.IsZero() && !t.firstByte.IsZero() {
		out["hermes_api_ttfb_ms"] = float64(t.firstByte.Sub(t.start).Milliseconds())
	}
	return out
}

func (e *Executor) doRequest(ctx context.Context, client *http.Client, name string, r task.APIRequest) (task.StepResult, map[string]float64, error) {
	start := time.Now()
	method := r.Method
	if method == "" {
		method = http.MethodGet
	}
	timeout := 30 * time.Second
	if r.TimeoutSec > 0 {
		timeout = time.Duration(r.TimeoutSec) * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var body io.Reader
	if r.Body != "" {
		body = strings.NewReader(r.Body)
	}

	pt := &probeTiming{start: start}
	cctx = httptrace.WithClientTrace(cctx, pt.trace())

	req, err := http.NewRequestWithContext(cctx, method, r.URL, body)
	if err != nil {
		tm := pt.metrics(time.Since(start).Milliseconds())
		return task.StepResult{Name: name, Success: false, Error: err.Error(), DurationMs: time.Since(start).Milliseconds()}, tm, err
	}
	for k, v := range r.Headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		tm := pt.metrics(time.Since(start).Milliseconds())
		return task.StepResult{Name: name, Success: false, Error: err.Error(), DurationMs: time.Since(start).Milliseconds()}, tm, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	text := string(b)
	totalMs := time.Since(start).Milliseconds()
	tm := pt.metrics(totalMs)

	expect := r.ExpectStatus
	if len(expect) == 0 {
		expect = []int{200, 201, 204}
	}
	statusOK := false
	for _, s := range expect {
		if resp.StatusCode == s {
			statusOK = true
			break
		}
	}
	contentOK := true
	if r.ExpectContains != "" && !strings.Contains(text, r.ExpectContains) {
		contentOK = false
	}
	ok := statusOK && contentOK
	sr := task.StepResult{
		Name: name,
		Success: ok,
		Output: fmt.Sprintf("status=%d dns=%.0fms connect=%.0fms tls=%.0fms ttfb=%.0fms total=%dms body=%s",
			resp.StatusCode, tm["hermes_api_dns_ms"], tm["hermes_api_connect_ms"], tm["hermes_api_tls_ms"], tm["hermes_api_ttfb_ms"], totalMs, truncate(text, 2048)),
		DurationMs: totalMs,
	}
	if !ok {
		sr.Error = fmt.Sprintf("status=%d statusOK=%v contentOK=%v", resp.StatusCode, statusOK, contentOK)
	}
	return sr, tm, nil
}

func prefixMetrics(prefix string, m map[string]float64) map[string]float64 {
	if m == nil {
		return map[string]float64{}
	}
	if prefix == "" {
		out := make(map[string]float64, len(m))
		for k, v := range m {
			out[k] = v
		}
		return out
	}
	out := make(map[string]float64, len(m))
	for k, v := range m {
		name := strings.Replace(k, "hermes_api_", "hermes_api_"+prefix, 1)
		out[name] = v
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func ternary(c bool, a, b string) string {
	if c {
		return a
	}
	return b
}
