package worker

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/jpsoft/hermes/internal/audit"
	"github.com/jpsoft/hermes/internal/bus"
	"github.com/jpsoft/hermes/internal/executor"
	"github.com/jpsoft/hermes/internal/lease"
	"github.com/jpsoft/hermes/internal/metrics"
	"github.com/jpsoft/hermes/internal/task"
)

type Runner struct {
	Bus       *bus.RedisStream
	Lease     *lease.Manager
	Registry  *executor.Registry
	Audit     *audit.Store
	NodeID    string
	Consumer  string
	Timeout   time.Duration
	MaxRetry  int
	ClaimIdle time.Duration // min idle before XAUTOCLAIM reclaim
}

func (r *Runner) Loop(ctx context.Context) {
	log.Printf("worker started node=%s consumer=%s", r.NodeID, r.Consumer)
	idle := r.ClaimIdle
	if idle <= 0 {
		idle = 2 * time.Minute
	}
	reclaimTick := time.NewTicker(idle / 2)
	defer reclaimTick.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-reclaimTick.C:
			// hard drain: still reclaim stuck messages so queue can empty safely
			msgs, err := r.Bus.ReclaimIdle(ctx, r.Consumer, idle, 4)
			if err != nil {
				log.Printf("reclaim error: %v", err)
			} else {
				for _, m := range msgs {
					metrics.JobsReclaimed.Inc()
					r.handle(ctx, m)
				}
			}
		default:
		}

		// D06: hard drain stops claiming new stream messages
		if hard, _ := r.Bus.IsHardDrain(ctx); hard {
			time.Sleep(time.Second)
			continue
		}

		msgs, err := r.Bus.Claim(ctx, r.Consumer, 1, 2*time.Second)
		if err != nil {
			log.Printf("claim error: %v", err)
			time.Sleep(time.Second)
			continue
		}
		for _, m := range msgs {
			r.handle(ctx, m)
		}
	}
}

func (r *Runner) handle(ctx context.Context, m bus.ClaimedMessage) {
	job := m.Job
	// honour cancel (F-SCHED-10): reload latest status
	if fresh, err := r.Bus.GetJob(ctx, job.ID); err == nil && fresh != nil {
		if fresh.Status == task.StatusCancelled {
			log.Printf("skip cancelled job=%s", job.ID)
			_ = r.Bus.Ack(ctx, m.StreamID)
			return
		}
		job = fresh
	}

	ok, err := r.Lease.Acquire(ctx, job.ID, r.NodeID)
	if err != nil || !ok {
		log.Printf("lease skip job=%s err=%v ok=%v", job.ID, err, ok)
		_ = r.Bus.Ack(ctx, m.StreamID)
		return
	}
	defer func() { _ = r.Lease.Release(ctx, job.ID, r.NodeID) }()

	// re-check cancel after lease
	if fresh, err := r.Bus.GetJob(ctx, job.ID); err == nil && fresh != nil && fresh.Status == task.StatusCancelled {
		log.Printf("skip cancelled after lease job=%s", job.ID)
		_ = r.Bus.Ack(ctx, m.StreamID)
		return
	}

	job.Status = task.StatusRunning
	job.NodeID = r.NodeID
	until := time.Now().UTC().Add(r.Timeout)
	job.LeaseUntil = &until
	_ = r.Bus.SaveJob(ctx, job)

	timeout := r.Timeout
	if job.TimeoutSec > 0 {
		timeout = time.Duration(job.TimeoutSec) * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	start := time.Now()
	result, err := r.Registry.Run(cctx, job)
	if err != nil && result == nil {
		result = &task.Result{Success: false, Message: err.Error()}
	}
	if result.DurationMs == 0 {
		result.DurationMs = time.Since(start).Milliseconds()
	}
	job.Result = result
	metrics.JobDuration.WithLabelValues(string(job.Protocol)).Observe(float64(result.DurationMs) / 1000)
	metrics.ObserveBrowserJourney(job, result)

	if result.Success {
		job.Status = task.StatusSuccess
		metrics.JobsFinished.WithLabelValues(string(job.Protocol), "true").Inc()
		_ = r.Bus.SaveJob(ctx, job)
		r.writeAudit(ctx, job, result.Message)
	} else if !resultRetryable(result) {
		// Deterministic / non-retryable failure (e.g. browser assert) → terminal FAILED.
		job.Status = task.StatusFailed
		_ = r.Bus.SaveJob(ctx, job)
		metrics.JobsFinished.WithLabelValues(string(job.Protocol), "false").Inc()
		r.writeAudit(ctx, job, result.Message)
	} else {
		job.Retries++
		limit := max(job.MaxRetries, r.MaxRetry)
		if job.Retries <= limit {
			job.Status = task.StatusRetryWait
			_ = r.Bus.Requeue(ctx, job)
			_ = r.Bus.SaveJob(ctx, job)
		} else {
			reason := result.Message
			if reason == "" {
				reason = "max retries exceeded"
			}
			if err := r.Bus.DeadLetter(ctx, job, reason); err != nil {
				log.Printf("dlq error job=%s: %v", job.ID, err)
			}
			_ = r.Bus.SaveJob(ctx, job)
			metrics.JobsDeadLetter.WithLabelValues(string(job.Protocol)).Inc()
			metrics.JobsFinished.WithLabelValues(string(job.Protocol), "false").Inc()
			r.writeAudit(ctx, job, reason)
		}
	}
	_ = r.Bus.Ack(ctx, m.StreamID)
	log.Printf("job done id=%s protocol=%s status=%s success=%s trace=%s",
		job.ID, job.Protocol, job.Status, strconv.FormatBool(result.Success), job.TraceID)
}

func (r *Runner) writeAudit(ctx context.Context, job *task.Job, message string) {
	if r.Audit == nil || job == nil {
		return
	}
	success := job.Result != nil && job.Result.Success
	ev := audit.Event{
		JobID:     job.ID,
		TraceID:   job.TraceID,
		Actor:     audit.ActorFromLabels(job.Labels, "api"),
		NodeID:    r.NodeID,
		Protocol:  string(job.Protocol),
		Name:      job.Name,
		Asset:     audit.AssetFromJob(job),
		Purpose:   audit.PurposeFromJob(job),
		Status:    string(job.Status),
		Success:   &success,
		Message:   message,
		CreatedAt: time.Now().UTC(),
	}
	if err := r.Audit.Append(ctx, ev); err != nil {
		log.Printf("audit write error job=%s: %v", job.ID, err)
		return
	}
	metrics.AuditWritten.Inc()
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// resultRetryable: nil/true → may retry; explicit false → terminal fail.
func resultRetryable(result *task.Result) bool {
	if result == nil || result.Retryable == nil {
		return true
	}
	return *result.Retryable
}
