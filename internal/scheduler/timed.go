package scheduler

import (
	"context"
	"log"
	"time"

	"github.com/jpsoft/hermes/internal/bus"
	"github.com/jpsoft/hermes/internal/metrics"
	"github.com/jpsoft/hermes/internal/task"
)

// Timed polls Redis ZSET and enqueues due jobs onto the stream (F-SCHED-01).
type Timed struct {
	Bus      *bus.RedisStream
	Interval time.Duration
	Batch    int64
}

func (t *Timed) Loop(ctx context.Context) {
	interval := t.Interval
	if interval <= 0 {
		interval = 2 * time.Second
	}
	batch := t.Batch
	if batch <= 0 {
		batch = 16
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	log.Printf("timed scheduler started interval=%s", interval)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			t.tick(ctx, batch)
		}
	}
}

func (t *Timed) tick(ctx context.Context, batch int64) {
	if draining, _ := t.Bus.IsDrain(ctx); draining {
		return
	}
	ids, err := t.Bus.DueJobs(ctx, time.Now().UTC(), batch)
	if err != nil {
		log.Printf("sched due error: %v", err)
		return
	}
	for _, id := range ids {
		job, err := t.Bus.GetJob(ctx, id)
		if err != nil {
			log.Printf("sched missing job=%s: %v", id, err)
			continue
		}
		if job.Status == task.StatusCancelled || job.Status == task.StatusSuccess || job.Status == task.StatusFailed {
			continue
		}
		job.Status = task.StatusPending
		if _, err := t.Bus.Enqueue(ctx, job); err != nil {
			log.Printf("sched enqueue job=%s: %v", id, err)
			// put back so we retry next tick
			if job.RunAt != nil {
				_ = t.Bus.ScheduleAt(ctx, job.ID, *job.RunAt)
			}
			continue
		}
		_ = t.Bus.SaveJob(ctx, job)
		metrics.JobsScheduled.WithLabelValues(string(job.Protocol)).Inc()
		log.Printf("sched fired job=%s protocol=%s", job.ID, job.Protocol)
	}
}
