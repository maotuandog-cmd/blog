package quota

import (
	"context"
	"sync"
)

// Pool is a fixed-size concurrency pool. Acquire waits until a slot is free or ctx done.
type Pool struct {
	ch chan struct{}
	mu sync.Mutex
}

func New(size int) *Pool {
	if size <= 0 {
		size = 1
	}
	p := &Pool{ch: make(chan struct{}, size)}
	for i := 0; i < size; i++ {
		p.ch <- struct{}{}
	}
	return p
}

func (p *Pool) Cap() int { return cap(p.ch) }

func (p *Pool) Active() int {
	return cap(p.ch) - len(p.ch)
}

// Acquire blocks until a slot is available or ctx is cancelled.
func (p *Pool) Acquire(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-p.ch:
		return nil
	}
}

func (p *Pool) Release() {
	select {
	case p.ch <- struct{}{}:
	default:
		// over-release ignored
	}
}
