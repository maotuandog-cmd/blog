package bus

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jpsoft/hermes/internal/task"
	"github.com/redis/go-redis/v9"
)

const (
	fieldPayload = "payload"
	fieldID      = "id"
)

type RedisStream struct {
	client *redis.Client
	key    string
	dlqKey string
	group  string
}

func NewRedisStream(addr, password string, db int, key, group string) *RedisStream {
	return NewRedisStreamWithDLQ(addr, password, db, key, key+":dlq", group)
}

func NewRedisStreamWithDLQ(addr, password string, db int, key, dlqKey, group string) *RedisStream {
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})
	if dlqKey == "" {
		dlqKey = key + ":dlq"
	}
	return &RedisStream{client: rdb, key: key, dlqKey: dlqKey, group: group}
}

func (s *RedisStream) Client() *redis.Client { return s.client }
func (s *RedisStream) StreamKey() string     { return s.key }
func (s *RedisStream) DLQKey() string        { return s.dlqKey }

func (s *RedisStream) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}

func (s *RedisStream) EnsureGroup(ctx context.Context) error {
	err := s.client.XGroupCreateMkStream(ctx, s.key, s.group, "0").Err()
	if err != nil && err.Error() != "BUSYGROUP Consumer Group name already exists" {
		return err
	}
	return nil
}

func (s *RedisStream) Enqueue(ctx context.Context, job *task.Job) (string, error) {
	if job.CreatedAt.IsZero() {
		job.CreatedAt = time.Now().UTC()
	}
	job.UpdatedAt = time.Now().UTC()
	if job.Status == "" {
		job.Status = task.StatusPending
	}
	b, err := json.Marshal(job)
	if err != nil {
		return "", err
	}
	id, err := s.client.XAdd(ctx, &redis.XAddArgs{
		Stream: s.key,
		Values: map[string]interface{}{
			fieldID:      job.ID,
			fieldPayload: string(b),
		},
	}).Result()
	return id, err
}

// Claim reads next messages for consumer (block briefly).
func (s *RedisStream) Claim(ctx context.Context, consumer string, count int64, block time.Duration) ([]ClaimedMessage, error) {
	streams, err := s.client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    s.group,
		Consumer: consumer,
		Streams:  []string{s.key, ">"},
		Count:    count,
		Block:    block,
	}).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []ClaimedMessage
	for _, st := range streams {
		for _, msg := range st.Messages {
			raw, _ := msg.Values[fieldPayload].(string)
			var job task.Job
			if err := json.Unmarshal([]byte(raw), &job); err != nil {
				_ = s.client.XAck(ctx, s.key, s.group, msg.ID)
				continue
			}
			out = append(out, ClaimedMessage{StreamID: msg.ID, Job: &job})
		}
	}
	return out, nil
}

// ReclaimIdle claims pending messages that have been idle longer than minIdle
// (worker crash / lease expiry path). startID "0-0" scans from beginning.
func (s *RedisStream) ReclaimIdle(ctx context.Context, consumer string, minIdle time.Duration, count int64) ([]ClaimedMessage, error) {
	msgs, _, err := s.client.XAutoClaim(ctx, &redis.XAutoClaimArgs{
		Stream:   s.key,
		Group:    s.group,
		Consumer: consumer,
		MinIdle:  minIdle,
		Start:    "0-0",
		Count:    count,
	}).Result()
	if err != nil {
		return nil, err
	}
	var out []ClaimedMessage
	for _, msg := range msgs {
		raw, _ := msg.Values[fieldPayload].(string)
		var job task.Job
		if err := json.Unmarshal([]byte(raw), &job); err != nil {
			_ = s.client.XAck(ctx, s.key, s.group, msg.ID)
			continue
		}
		out = append(out, ClaimedMessage{StreamID: msg.ID, Job: &job})
	}
	return out, nil
}

func (s *RedisStream) Ack(ctx context.Context, streamID string) error {
	return s.client.XAck(ctx, s.key, s.group, streamID).Err()
}

func (s *RedisStream) Requeue(ctx context.Context, job *task.Job) error {
	job.Status = task.StatusRetryWait
	job.UpdatedAt = time.Now().UTC()
	_, err := s.Enqueue(ctx, job)
	return err
}

// DeadLetter writes a terminal-failed job to the DLQ stream and persists status.
func (s *RedisStream) DeadLetter(ctx context.Context, job *task.Job, reason string) error {
	job.Status = task.StatusFailed
	job.UpdatedAt = time.Now().UTC()
	if job.Result == nil {
		job.Result = &task.Result{Success: false, Message: reason}
	} else if reason != "" && job.Result.Message == "" {
		job.Result.Message = reason
	}
	b, err := json.Marshal(job)
	if err != nil {
		return err
	}
	_, err = s.client.XAdd(ctx, &redis.XAddArgs{
		Stream: s.dlqKey,
		Values: map[string]interface{}{
			fieldID:      job.ID,
			fieldPayload: string(b),
			"reason":     reason,
		},
	}).Result()
	return err
}

type ClaimedMessage struct {
	StreamID string
	Job      *task.Job
}

func JobKey(id string) string          { return fmt.Sprintf("hermes:job:%s", id) }
func IdempotencyKey(key string) string { return fmt.Sprintf("hermes:idem:%s", key) }
func SchedKey() string                 { return "hermes:sched" }

func (s *RedisStream) SaveJob(ctx context.Context, job *task.Job) error {
	job.UpdatedAt = time.Now().UTC()
	b, err := json.Marshal(job)
	if err != nil {
		return err
	}
	return s.client.Set(ctx, JobKey(job.ID), b, 7*24*time.Hour).Err()
}

func (s *RedisStream) GetJob(ctx context.Context, id string) (*task.Job, error) {
	b, err := s.client.Get(ctx, JobKey(id)).Bytes()
	if err != nil {
		return nil, err
	}
	var job task.Job
	if err := json.Unmarshal(b, &job); err != nil {
		return nil, err
	}
	return &job, nil
}

// ReserveIdempotency stores idempotencyKey -> jobID if absent.
// Returns (existingJobID, false, nil) when key already taken.
func (s *RedisStream) ReserveIdempotency(ctx context.Context, key, jobID string, ttl time.Duration) (existing string, created bool, err error) {
	if key == "" {
		return "", true, nil
	}
	ok, err := s.client.SetNX(ctx, IdempotencyKey(key), jobID, ttl).Result()
	if err != nil {
		return "", false, err
	}
	if ok {
		return "", true, nil
	}
	existing, err = s.client.Get(ctx, IdempotencyKey(key)).Result()
	return existing, false, err
}

// ScheduleAt adds a timed job to the delay ZSET (score = unix seconds).
func (s *RedisStream) ScheduleAt(ctx context.Context, jobID string, runAt time.Time) error {
	return s.client.ZAdd(ctx, SchedKey(), redis.Z{
		Score:  float64(runAt.UTC().Unix()),
		Member: jobID,
	}).Err()
}

// DueJobs returns up to limit job IDs whose runAt <= now, and removes them atomically via ZPOPMIN-style script.
func (s *RedisStream) DueJobs(ctx context.Context, now time.Time, limit int64) ([]string, error) {
	if limit <= 0 {
		limit = 16
	}
	// ZRANGEBYSCORE then ZREM — best-effort; duplicate enqueue guarded by lease.
	ids, err := s.client.ZRangeByScore(ctx, SchedKey(), &redis.ZRangeBy{
		Min:   "-inf",
		Max:   fmt.Sprintf("%d", now.UTC().Unix()),
		Count: limit,
	}).Result()
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, nil
	}
	members := make([]interface{}, len(ids))
	for i, id := range ids {
		members[i] = id
	}
	if err := s.client.ZRem(ctx, SchedKey(), members...).Err(); err != nil {
		return nil, err
	}
	return ids, nil
}

func DrainKey() string { return "hermes:drain" }

// Drain modes: "" / off, "soft" (refuse new jobs), "hard" (refuse new + workers stop claiming).
func (s *RedisStream) SetDrain(ctx context.Context, enabled bool) error {
	if enabled {
		return s.SetDrainMode(ctx, "soft")
	}
	return s.SetDrainMode(ctx, "")
}

func (s *RedisStream) SetDrainMode(ctx context.Context, mode string) error {
	mode = strings.ToLower(strings.TrimSpace(mode))
	switch mode {
	case "", "off", "false", "0":
		return s.client.Del(ctx, DrainKey()).Err()
	case "1", "true", "soft":
		return s.client.Set(ctx, DrainKey(), "soft", 0).Err()
	case "hard":
		return s.client.Set(ctx, DrainKey(), "hard", 0).Err()
	default:
		return fmt.Errorf("invalid drain mode %q (soft|hard|off)", mode)
	}
}

func (s *RedisStream) DrainMode(ctx context.Context) (string, error) {
	v, err := s.client.Get(ctx, DrainKey()).Result()
	if err == redis.Nil {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	v = strings.ToLower(strings.TrimSpace(v))
	if v == "1" || v == "true" || v == "yes" {
		return "soft", nil
	}
	if v == "soft" || v == "hard" {
		return v, nil
	}
	return "", nil
}

func (s *RedisStream) IsDrain(ctx context.Context) (bool, error) {
	mode, err := s.DrainMode(ctx)
	return mode != "", err
}

func (s *RedisStream) IsHardDrain(ctx context.Context) (bool, error) {
	mode, err := s.DrainMode(ctx)
	return mode == "hard", err
}

func (s *RedisStream) Unschedule(ctx context.Context, jobID string) error {
	return s.client.ZRem(ctx, SchedKey(), jobID).Err()
}

// QueueStats reports backlog for ops (F-ADM-02).
type QueueStats struct {
	StreamLength   int64  `json:"streamLength"`
	PendingCount   int64  `json:"pendingCount"`
	ScheduledCount int64  `json:"scheduledCount"`
	DLQLength      int64  `json:"dlqLength"`
	Drain          bool   `json:"drain"`
	DrainMode      string `json:"drainMode,omitempty"` // soft|hard
}

func (s *RedisStream) QueueStats(ctx context.Context) (QueueStats, error) {
	var st QueueStats
	var err error
	st.StreamLength, err = s.client.XLen(ctx, s.key).Result()
	if err != nil {
		return st, err
	}
	pending, err := s.client.XPending(ctx, s.key, s.group).Result()
	if err == nil && pending != nil {
		st.PendingCount = pending.Count
	}
	st.ScheduledCount, err = s.client.ZCard(ctx, SchedKey()).Result()
	if err != nil {
		return st, err
	}
	st.DLQLength, err = s.client.XLen(ctx, s.dlqKey).Result()
	if err != nil {
		return st, err
	}
	st.DrainMode, err = s.DrainMode(ctx)
	if err != nil {
		return st, err
	}
	st.Drain = st.DrainMode != ""
	return st, nil
}

// ForceRequeuePending reclaim idle pending messages and re-enqueue as fresh jobs.
func (s *RedisStream) ForceRequeuePending(ctx context.Context, minIdle time.Duration, count int64) (int, error) {
	if count <= 0 {
		count = 32
	}
	if minIdle < 0 {
		minIdle = 0
	}
	msgs, err := s.ReclaimIdle(ctx, "admin-reclaim", minIdle, count)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, m := range msgs {
		if m.Job == nil {
			_ = s.Ack(ctx, m.StreamID)
			continue
		}
		// skip cancelled
		if fresh, e := s.GetJob(ctx, m.Job.ID); e == nil && fresh != nil && fresh.Status == task.StatusCancelled {
			_ = s.Ack(ctx, m.StreamID)
			continue
		}
		m.Job.Status = task.StatusPending
		m.Job.NodeID = ""
		m.Job.LeaseUntil = nil
		if _, err := s.Enqueue(ctx, m.Job); err != nil {
			continue
		}
		_ = s.SaveJob(ctx, m.Job)
		_ = s.Ack(ctx, m.StreamID)
		_ = s.client.Del(ctx, fmt.Sprintf("hermes:lease:%s", m.Job.ID)).Err()
		n++
	}
	return n, nil
}

