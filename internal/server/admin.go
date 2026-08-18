package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jpsoft/hermes/internal/audit"
	"github.com/jpsoft/hermes/internal/metrics"
	"github.com/jpsoft/hermes/internal/task"
)

func (g *Gateway) queueStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	st, err := g.Bus.QueueStats(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (g *Gateway) reclaim(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// D07: default minIdle aligns with lease TTL (120s); avoid stealing active work.
	minIdleSec := 120
	count := int64(32)
	if v := r.URL.Query().Get("minIdleSec"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			minIdleSec = n
		}
	}
	if v := r.URL.Query().Get("count"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			count = n
		}
	}
	n, err := g.Bus.ForceRequeuePending(r.Context(), time.Duration(minIdleSec)*time.Second, count)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	metrics.JobsReclaimed.Add(float64(n))
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"requeued":    n,
		"minIdleSec":  minIdleSec,
		"count":       count,
		"note":        "default minIdleSec=120; set minIdleSec=0 only when sure no active consumers",
	})
}

type drainRequest struct {
	Enabled bool   `json:"enabled"`
	Mode    string `json:"mode"` // soft|hard; when enabled and empty => soft
}

func (g *Gateway) drain(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		mode, err := g.Bus.DrainMode(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"drain":     mode != "",
			"drainMode": mode,
			"semantics": "soft=refuse new jobs (workers finish backlog); hard=also stop claiming",
		})
		return
	case http.MethodPost:
		var req drainRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		mode := ""
		if req.Enabled {
			mode = strings.ToLower(strings.TrimSpace(req.Mode))
			if mode == "" {
				mode = "soft"
			}
		} else if req.Mode != "" {
			mode = strings.ToLower(strings.TrimSpace(req.Mode))
		}
		if err := g.Bus.SetDrainMode(r.Context(), mode); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		got, _ := g.Bus.DrainMode(r.Context())
		writeJSON(w, http.StatusOK, map[string]interface{}{"drain": got != "", "drainMode": got})
		return
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (g *Gateway) jobsRouter(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/jobs/")
	path = strings.Trim(path, "/")
	if path == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	parts := strings.Split(path, "/")
	id := parts[0]
	if len(parts) == 1 {
		if r.Method == http.MethodGet {
			g.getJobByID(w, r, id)
			return
		}
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	switch parts[1] {
	case "cancel":
		g.cancelJob(w, r, id)
	case "rerun":
		g.rerunJob(w, r, id)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

func (g *Gateway) getJobByID(w http.ResponseWriter, r *http.Request, id string) {
	job, err := g.Bus.GetJob(r.Context(), id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if job.TraceID != "" {
		w.Header().Set("X-Trace-Id", job.TraceID)
	}
	writeJobJSON(w, http.StatusOK, job)
}

func (g *Gateway) cancelJob(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	job, err := g.Bus.GetJob(r.Context(), id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	switch job.Status {
	case task.StatusSuccess, task.StatusFailed, task.StatusCancelled:
		http.Error(w, "job already terminal: "+string(job.Status), http.StatusConflict)
		return
	}
	job.Status = task.StatusCancelled
	_ = g.Bus.Unschedule(r.Context(), job.ID)
	_ = g.Bus.SaveJob(r.Context(), job)
	g.writeStatusAudit(r.Context(), job, "cancelled")
	writeJobJSON(w, http.StatusOK, job)
}

func (g *Gateway) rerunJob(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	draining, _ := g.Bus.IsDrain(r.Context())
	if draining {
		http.Error(w, "node is draining; refuse new work", http.StatusServiceUnavailable)
		return
	}
	job, err := g.Bus.GetJob(r.Context(), id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	switch job.Status {
	case task.StatusSuccess, task.StatusFailed, task.StatusCancelled:
		// ok
	default:
		http.Error(w, "only terminal jobs can rerun", http.StatusConflict)
		return
	}
	job.Status = task.StatusPending
	job.Retries = 0
	job.Result = nil
	job.NodeID = ""
	job.LeaseUntil = nil
	if _, err := g.Bus.Enqueue(r.Context(), job); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = g.Bus.SaveJob(r.Context(), job)
	metrics.JobsEnqueued.WithLabelValues(string(job.Protocol)).Inc()
	g.writeSubmitAudit(r.Context(), job)
	writeJobJSON(w, http.StatusAccepted, job)
}

func (g *Gateway) writeStatusAudit(ctx context.Context, job *task.Job, message string) {
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
		Message:   message,
		CreatedAt: time.Now().UTC(),
	}
	if err := g.Audit.Append(ctx, ev); err == nil {
		metrics.AuditWritten.Inc()
	}
}
