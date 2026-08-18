package quota

import (
	"context"
	"testing"
	"time"
)

func TestPoolAcquireRelease(t *testing.T) {
	p := New(1)
	ctx := context.Background()
	if err := p.Acquire(ctx); err != nil {
		t.Fatal(err)
	}
	if p.Active() != 1 {
		t.Fatalf("active=%d", p.Active())
	}
	done := make(chan error, 1)
	go func() {
		cctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()
		done <- p.Acquire(cctx)
	}()
	if err := <-done; err == nil {
		t.Fatal("expected timeout while slot held")
	}
	p.Release()
	if err := p.Acquire(ctx); err != nil {
		t.Fatal(err)
	}
	p.Release()
}
