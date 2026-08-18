package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const keyZ = "hermes:audit:z"
const keyEntry = "hermes:audit:e:" // + id

// Event is a searchable execution audit record (F-SCHED-08).
type Event struct {
	ID        string    `json:"id"`
	JobID     string    `json:"jobId"`
	TraceID   string    `json:"traceId,omitempty"`
	Actor     string    `json:"actor"`
	NodeID    string    `json:"nodeId,omitempty"`
	Protocol  string    `json:"protocol"`
	Name      string    `json:"name,omitempty"`
	Asset     string    `json:"asset,omitempty"` // host / url
	Purpose   string    `json:"purpose,omitempty"`
	Status    string    `json:"status"`
	Success   *bool     `json:"success,omitempty"`
	Message   string    `json:"message,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type Store struct {
	rdb *redis.Client
	ttl time.Duration
}

func NewStore(rdb *redis.Client, ttl time.Duration) *Store {
	if ttl <= 0 {
		ttl = 30 * 24 * time.Hour
	}
	return &Store{rdb: rdb, ttl: ttl}
}

func (s *Store) Append(ctx context.Context, ev Event) error {
	if ev.ID == "" {
		ev.ID = fmt.Sprintf("%s-%d", ev.JobID, time.Now().UTC().UnixNano())
	}
	if ev.CreatedAt.IsZero() {
		ev.CreatedAt = time.Now().UTC()
	}
	b, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	pipe := s.rdb.TxPipeline()
	pipe.Set(ctx, keyEntry+ev.ID, b, s.ttl)
	pipe.ZAdd(ctx, keyZ, redis.Z{Score: float64(ev.CreatedAt.Unix()), Member: ev.ID})
	_, err = pipe.Exec(ctx)
	return err
}

type Query struct {
	From     time.Time
	To       time.Time
	Protocol string
	Actor    string
	JobID    string
	Limit    int64
}

func (s *Store) Search(ctx context.Context, q Query) ([]Event, error) {
	limit := q.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	min := "-inf"
	max := "+inf"
	if !q.From.IsZero() {
		min = strconv.FormatInt(q.From.Unix(), 10)
	}
	if !q.To.IsZero() {
		max = strconv.FormatInt(q.To.Unix(), 10)
	}
	// newest first: fetch more then filter
	ids, err := s.rdb.ZRevRangeByScore(ctx, keyZ, &redis.ZRangeBy{
		Min:    min,
		Max:    max,
		Offset: 0,
		Count:  limit * 3,
	}).Result()
	if err != nil {
		return nil, err
	}
	out := make([]Event, 0, limit)
	for _, id := range ids {
		b, err := s.rdb.Get(ctx, keyEntry+id).Bytes()
		if err != nil {
			continue
		}
		var ev Event
		if err := json.Unmarshal(b, &ev); err != nil {
			continue
		}
		if q.Protocol != "" && !strings.EqualFold(ev.Protocol, q.Protocol) {
			continue
		}
		if q.Actor != "" && !strings.EqualFold(ev.Actor, q.Actor) {
			continue
		}
		if q.JobID != "" && ev.JobID != q.JobID {
			continue
		}
		out = append(out, ev)
		if int64(len(out)) >= limit {
			break
		}
	}
	return out, nil
}
