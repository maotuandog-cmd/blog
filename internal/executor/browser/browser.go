package browser

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jpsoft/hermes/internal/allowlist"
	"github.com/jpsoft/hermes/internal/metrics"
	"github.com/jpsoft/hermes/internal/quota"
	"github.com/jpsoft/hermes/internal/task"
)

// Executor delegates browser journeys to the Node worker.
type Executor struct {
	baseURL   string
	client    *http.Client
	nodeAllow []string
	defaultAD string
	proxyURL  string
	browser   *quota.Pool
	agent     *quota.Pool
	llmKey    string
	llmBase   string
	llmModel  string
}

type Options struct {
	BaseURL           string
	NodeAllowHosts    []string
	DefaultAntiDetect string
	ProxyURL          string
	BrowserMaxCount   int
	AgentMaxCount     int
	LLMAPIKey         string
	LLMBaseURL        string
	LLMModel          string
}

func New(opts Options) *Executor {
	bMax := opts.BrowserMaxCount
	if bMax <= 0 {
		bMax = 2
	}
	aMax := opts.AgentMaxCount
	if aMax <= 0 {
		aMax = 1
	}
	ad := opts.DefaultAntiDetect
	if ad == "" {
		ad = "L3"
	}
	return &Executor{
		baseURL:   opts.BaseURL,
		client:    &http.Client{Timeout: 15 * time.Minute},
		nodeAllow: opts.NodeAllowHosts,
		defaultAD: ad,
		proxyURL:  opts.ProxyURL,
		browser:   quota.New(bMax),
		agent:     quota.New(aMax),
		llmKey:    opts.LLMAPIKey,
		llmBase:   opts.LLMBaseURL,
		llmModel:  opts.LLMModel,
	}
}

func (e *Executor) Protocol() task.Protocol { return task.ProtocolBrowser }

// AgentExecutor wraps the same worker for BROWSER_AGENT.
type AgentExecutor struct{ *Executor }

func (a *AgentExecutor) Protocol() task.Protocol { return task.ProtocolBrowserAgent }

func (e *Executor) Execute(ctx context.Context, job *task.Job) (*task.Result, error) {
	return e.run(ctx, job, "/v1/browser/run", false)
}

func (a *AgentExecutor) Execute(ctx context.Context, job *task.Job) (*task.Result, error) {
	return a.run(ctx, job, "/v1/browser/agent", true)
}

func (e *Executor) run(ctx context.Context, job *task.Job, path string, agent bool) (*task.Result, error) {
	start := time.Now()
	pool := e.browser
	label := "browser"
	if agent {
		if err := e.precheckAgent(job); err != nil {
			metrics.AgentDenied.WithLabelValues("validate").Inc()
			return &task.Result{
				Success:    false,
				Message:    err.Error(),
				DurationMs: time.Since(start).Milliseconds(),
				Retryable:  boolPtr(false),
			}, nil
		}
		pool = e.agent
		label = "agent"
	}

	// F-SCHED-06 / F-BRW-05: wait for slot (queue) instead of unbounded spawn.
	metrics.BrowserPoolWaiting.WithLabelValues(label).Inc()
	if err := pool.Acquire(ctx); err != nil {
		metrics.BrowserPoolWaiting.WithLabelValues(label).Dec()
		metrics.BrowserQuotaTimeout.WithLabelValues(label).Inc()
		return &task.Result{
			Success:    false,
			Message:    fmt.Sprintf("browser %s quota wait: %v", label, err),
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	}
	metrics.BrowserPoolWaiting.WithLabelValues(label).Dec()
	defer pool.Release()
	e.refreshPoolGauges()

	payload := json.RawMessage(job.Payload)
	if agent {
		enriched, err := e.enrichAgentPayload(job.Payload)
		if err != nil {
			return &task.Result{Success: false, Message: err.Error(), Retryable: boolPtr(false)}, nil
		}
		payload = enriched
	}

	reqBody := map[string]interface{}{
		"jobId":   job.ID,
		"payload": payload,
		"llm": map[string]string{
			"apiKey":  e.llmKey,
			"baseUrl": e.llmBase,
			"model":   e.llmModel,
		},
	}
	b, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return &task.Result{Success: false, Message: err.Error()}, nil
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		return &task.Result{Success: false, Message: "browser worker: " + err.Error(), DurationMs: time.Since(start).Milliseconds()}, nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if resp.StatusCode >= 300 {
		return &task.Result{
			Success:    false,
			Message:    fmt.Sprintf("browser worker status=%d body=%s", resp.StatusCode, string(body)),
			DurationMs: time.Since(start).Milliseconds(),
		}, nil
	}
	var result task.Result
	if err := json.Unmarshal(body, &result); err != nil {
		return &task.Result{Success: false, Message: "decode worker result: " + err.Error()}, nil
	}
	if result.DurationMs == 0 {
		result.DurationMs = time.Since(start).Milliseconds()
	}
	// Journey completed (worker returned 2xx + Result): assert/script/agent failures are deterministic.
	if !result.Success && result.Retryable == nil {
		result.Retryable = boolPtr(false)
	}
	e.refreshPoolGauges()
	return &result, nil
}

func boolPtr(v bool) *bool { return &v }

func (e *Executor) refreshPoolGauges() {
	metrics.BrowserPoolActive.WithLabelValues("browser").Set(float64(e.browser.Active()))
	metrics.BrowserPoolActive.WithLabelValues("agent").Set(float64(e.agent.Active()))
}

func (e *Executor) precheckAgent(job *task.Job) error {
	var p task.BrowserAgentPayload
	if err := json.Unmarshal(job.Payload, &p); err != nil {
		return fmt.Errorf("invalid agent payload: %w", err)
	}
	if p.Goal == "" || p.StartURL == "" {
		return fmt.Errorf("goal and startUrl required")
	}
	if p.Purpose == "" {
		return fmt.Errorf("purpose declaration required for agent tasks")
	}
	merged := allowlist.Merge(e.nodeAllow, p.AllowedHosts)
	if len(merged) == 0 {
		return fmt.Errorf("allowlist empty: set HERMES_ALLOWED_HOSTS and/or payload.allowedHosts")
	}
	return allowlist.URLAllowed(p.StartURL, merged)
}

func (e *Executor) enrichAgentPayload(raw json.RawMessage) (json.RawMessage, error) {
	var p task.BrowserAgentPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, err
	}
	if p.AntiDetect == "" {
		p.AntiDetect = e.defaultAD
	}
	if p.ProxyURL == "" {
		p.ProxyURL = e.proxyURL
	}
	merged := allowlist.Merge(e.nodeAllow, p.AllowedHosts)
	p.AllowedHosts = merged
	return json.Marshal(p)
}

func (e *Executor) ActiveBrowsers() int { return e.browser.Active() }
func (e *Executor) ActiveAgents() int   { return e.agent.Active() }
