package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jpsoft/hermes/internal/allowlist"
	"github.com/jpsoft/hermes/internal/audit"
	"github.com/jpsoft/hermes/internal/bus"
	"github.com/jpsoft/hermes/internal/metrics"
	"github.com/jpsoft/hermes/internal/security"
	"github.com/jpsoft/hermes/internal/task"
)

type Gateway struct {
	Bus          *bus.RedisStream
	Audit        *audit.Store
	NodeID       string
	AllowedHosts []string
	APIToken     string
	APIInsecure  bool
	HMACSecret   string
}

func (g *Gateway) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", g.healthz)
	mux.HandleFunc("/readyz", g.readyz)
	mux.Handle("/metrics", metrics.Handler())
	mux.HandleFunc("/v1/jobs", g.auth(g.createJob))
	mux.HandleFunc("/v1/jobs/", g.auth(g.jobsRouter))
	mux.HandleFunc("/v1/audit", g.auth(g.listAudit))
	mux.HandleFunc("/v1/admin/queue", g.auth(g.queueStats))
	mux.HandleFunc("/v1/admin/reclaim", g.auth(g.reclaim))
	mux.HandleFunc("/v1/admin/drain", g.auth(g.drain))
	return withCORS(mux)
}

// withCORS allows hermes-ui (and other browser clients) to call the Gateway.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key, X-Hermes-Signature, X-Trace-Id")
		w.Header().Set("Access-Control-Expose-Headers", "Idempotency-Replayed, X-Trace-Id")
		if origin != "*" {
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// auth enforces F-SEC-04: default deny unless token matches or insecure mode.
func (g *Gateway) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if g.APIToken == "" {
			if !g.APIInsecure {
				http.Error(w, "unauthorized: set HERMES_API_TOKEN (or HERMES_API_INSECURE=true for local only)", http.StatusUnauthorized)
				return
			}
			next(w, r)
			return
		}
		got := bearerToken(r.Header.Get("Authorization"))
		if got == "" || got != g.APIToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func bearerToken(h string) string {
	const p = "Bearer "
	if len(h) < len(p) || !strings.EqualFold(h[:len(p)], p) {
		return ""
	}
	return strings.TrimSpace(h[len(p):])
}

func (g *Gateway) healthz(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (g *Gateway) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := g.Bus.Ping(ctx); err != nil {
		http.Error(w, "redis not ready: "+err.Error(), http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

type createJobRequest struct {
	Name       string            `json:"name"`
	Protocol   task.Protocol     `json:"protocol"`
	Type       string            `json:"type"` // instant | timed
	Payload    json.RawMessage   `json:"payload"`
	MaxRetries int               `json:"maxRetries"`
	TimeoutSec int               `json:"timeoutSec"`
	Labels     map[string]string `json:"labels"`
	RunAt      *time.Time        `json:"runAt"` // required when type=timed
}

func (g *Gateway) createJob(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if draining, _ := g.Bus.IsDrain(r.Context()); draining {
		http.Error(w, "node is draining; refuse new work", http.StatusServiceUnavailable)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if g.HMACSecret != "" {
		if err := security.VerifyHeader(g.HMACSecret, r.Header.Get(security.HeaderSignature), body); err != nil {
			metrics.HMACRejected.Inc()
			http.Error(w, "hmac: "+err.Error(), http.StatusUnauthorized)
			return
		}
	}

	var req createJobRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Protocol == "" || len(req.Payload) == 0 {
		http.Error(w, "protocol and payload required", http.StatusBadRequest)
		return
	}
	if req.Protocol == task.ProtocolBrowserAgent {
		if err := validateAgentPayload(req.Payload, g.AllowedHosts); err != nil {
			metrics.AgentDenied.WithLabelValues("gateway_validate").Inc()
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}
	if req.Type == "" {
		req.Type = "instant"
	}
	if req.Type != "instant" && req.Type != "timed" {
		http.Error(w, "type must be instant or timed", http.StatusBadRequest)
		return
	}
	if req.Type == "timed" {
		if req.RunAt == nil {
			http.Error(w, "runAt required for timed jobs", http.StatusBadRequest)
			return
		}
		if req.RunAt.UTC().Before(time.Now().UTC().Add(-30 * time.Second)) {
			http.Error(w, "runAt is too far in the past", http.StatusBadRequest)
			return
		}
	}

	traceID := strings.TrimSpace(r.Header.Get("X-Trace-Id"))
	if traceID == "" {
		traceID = uuid.NewString()
	}
	idemKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))

	jobID := uuid.NewString()
	if idemKey != "" {
		existing, created, err := g.Bus.ReserveIdempotency(r.Context(), idemKey, jobID, 24*time.Hour)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if !created {
			job, err := g.Bus.GetJob(r.Context(), existing)
			if err != nil {
				http.Error(w, "idempotent job missing: "+err.Error(), http.StatusConflict)
				return
			}
			w.Header().Set("X-Trace-Id", job.TraceID)
			w.Header().Set("Idempotency-Replayed", "true")
			writeJobJSON(w, http.StatusOK, job)
			return
		}
	}

	job := &task.Job{
		ID:             jobID,
		Name:           req.Name,
		Protocol:       req.Protocol,
		Type:           req.Type,
		Status:         task.StatusPending,
		Payload:        req.Payload,
		Labels:         req.Labels,
		MaxRetries:     req.MaxRetries,
		TimeoutSec:     req.TimeoutSec,
		IdempotencyKey: idemKey,
		TraceID:        traceID,
		RunAt:          req.RunAt,
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}
	if job.Labels == nil {
		job.Labels = map[string]string{}
	}
	if actor := strings.TrimSpace(r.Header.Get("X-Actor")); actor != "" {
		job.Labels["actor"] = actor
	}
	if job.MaxRetries == 0 {
		job.MaxRetries = 3
	}

	if req.Type == "timed" {
		_ = g.Bus.SaveJob(r.Context(), job)
		if err := g.Bus.ScheduleAt(r.Context(), job.ID, req.RunAt.UTC()); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		g.writeSubmitAudit(r.Context(), job)
		metrics.JobsEnqueued.WithLabelValues(string(job.Protocol)).Inc()
		w.Header().Set("X-Trace-Id", job.TraceID)
		writeJobJSON(w, http.StatusAccepted, job)
		return
	}

	if _, err := g.Bus.Enqueue(r.Context(), job); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = g.Bus.SaveJob(r.Context(), job)
	g.writeSubmitAudit(r.Context(), job)
	metrics.JobsEnqueued.WithLabelValues(string(job.Protocol)).Inc()
	w.Header().Set("X-Trace-Id", job.TraceID)
	writeJobJSON(w, http.StatusAccepted, job)
}

func validateAgentPayload(raw json.RawMessage, nodeAllow []string) error {
	var p task.BrowserAgentPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return err
	}
	if p.Goal == "" || p.StartURL == "" {
		return errString("goal and startUrl required")
	}
	if p.Purpose == "" {
		return errString("purpose declaration required")
	}
	merged := allowlist.Merge(nodeAllow, p.AllowedHosts)
	if len(merged) == 0 {
		return errString("allowlist empty: configure HERMES_ALLOWED_HOSTS")
	}
	return allowlist.URLAllowed(p.StartURL, merged)
}

type strErr string

func (e strErr) Error() string { return string(e) }
func errString(s string) error { return strErr(s) }

func (g *Gateway) getJob(w http.ResponseWriter, r *http.Request) {
	// kept for compatibility; routing goes through jobsRouter
	g.jobsRouter(w, r)
}

func (g *Gateway) listAudit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if g.Audit == nil {
		http.Error(w, "audit store unavailable", http.StatusServiceUnavailable)
		return
	}
	q := audit.Query{
		Protocol: r.URL.Query().Get("protocol"),
		Actor:    r.URL.Query().Get("actor"),
		JobID:    r.URL.Query().Get("jobId"),
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			q.Limit = n
		}
	}
	if v := r.URL.Query().Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q.From = t
		}
	}
	if v := r.URL.Query().Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q.To = t
		}
	}
	evs, err := g.Audit.Search(r.Context(), q)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"items": evs, "count": len(evs)})
}

func (g *Gateway) writeSubmitAudit(ctx context.Context, job *task.Job) {
	if g.Audit == nil || job == nil {
		return
	}
	ev := audit.Event{
		JobID:     job.ID,
		TraceID:   job.TraceID,
		Actor:     audit.ActorFromLabels(job.Labels, "api"),
		NodeID:    g.NodeID,
		Protocol:  string(job.Protocol),
		Name:      job.Name,
		Asset:     audit.AssetFromJob(job),
		Purpose:   audit.PurposeFromJob(job),
		Status:    string(job.Status),
		Message:   "submitted",
		CreatedAt: time.Now().UTC(),
	}
	if err := g.Audit.Append(ctx, ev); err == nil {
		metrics.AuditWritten.Inc()
	}
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJobJSON(w http.ResponseWriter, code int, job *task.Job) {
	writeJSON(w, code, security.RedactedJob(job))
}
