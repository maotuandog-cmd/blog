package lease

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Manager tracks running leases so crashed workers can be recovered.
type Manager struct {
	rdb *redis.Client
	ttl time.Duration
}

func NewManager(rdb *redis.Client, ttl time.Duration) *Manager {
	return &Manager{rdb: rdb, ttl: ttl}
}

func key(jobID string) string { return fmt.Sprintf("hermes:lease:%s", jobID) }

func (m *Manager) Acquire(ctx context.Context, jobID, nodeID string) (bool, error) {
	ok, err := m.rdb.SetNX(ctx, key(jobID), nodeID, m.ttl).Result()
	return ok, err
}

func (m *Manager) Renew(ctx context.Context, jobID, nodeID string) error {
	cur, err := m.rdb.Get(ctx, key(jobID)).Result()
	if err != nil {
		return err
	}
	if cur != nodeID {
		return fmt.Errorf("lease owned by %s", cur)
	}
	return m.rdb.Expire(ctx, key(jobID), m.ttl).Err()
}

func (m *Manager) Release(ctx context.Context, jobID, nodeID string) error {
	cur, err := m.rdb.Get(ctx, key(jobID)).Result()
	if err == redis.Nil {
		return nil
	}
	if err != nil {
		return err
	}
	if cur != nodeID {
		return nil
	}
	return m.rdb.Del(ctx, key(jobID)).Err()
}
