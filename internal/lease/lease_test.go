package lease

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestAcquireExclusive(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	m := NewManager(rdb, 2*time.Second)
	ctx := context.Background()

	ok, err := m.Acquire(ctx, "job-1", "node-a")
	if err != nil || !ok {
		t.Fatalf("first acquire: ok=%v err=%v", ok, err)
	}
	ok, err = m.Acquire(ctx, "job-1", "node-b")
	if err != nil || ok {
		t.Fatalf("second acquire should fail: ok=%v err=%v", ok, err)
	}
	if err := m.Release(ctx, "job-1", "node-a"); err != nil {
		t.Fatal(err)
	}
	ok, err = m.Acquire(ctx, "job-1", "node-b")
	if err != nil || !ok {
		t.Fatalf("after release: ok=%v err=%v", ok, err)
	}
}

func TestRenewWrongOwner(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	m := NewManager(rdb, time.Second)
	ctx := context.Background()
	_, _ = m.Acquire(ctx, "j", "a")
	if err := m.Renew(ctx, "j", "b"); err == nil {
		t.Fatal("expected renew denied for wrong owner")
	}
}

func TestLeaseExpiryAllowsReacquire(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	m := NewManager(rdb, time.Second)
	ctx := context.Background()
	ok, _ := m.Acquire(ctx, "j", "a")
	if !ok {
		t.Fatal("acquire")
	}
	mr.FastForward(2 * time.Second)
	ok, err = m.Acquire(ctx, "j", "b")
	if err != nil || !ok {
		t.Fatalf("after expiry: ok=%v err=%v", ok, err)
	}
}
