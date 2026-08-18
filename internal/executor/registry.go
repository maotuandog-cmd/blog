package executor

import (
	"context"
	"fmt"

	"github.com/jpsoft/hermes/internal/task"
)

type Executor interface {
	Protocol() task.Protocol
	Execute(ctx context.Context, job *task.Job) (*task.Result, error)
}

type Registry struct {
	byProtocol map[task.Protocol]Executor
}

func NewRegistry(execs ...Executor) *Registry {
	r := &Registry{byProtocol: map[task.Protocol]Executor{}}
	for _, e := range execs {
		r.byProtocol[e.Protocol()] = e
	}
	return r
}

func (r *Registry) Run(ctx context.Context, job *task.Job) (*task.Result, error) {
	ex, ok := r.byProtocol[job.Protocol]
	if !ok {
		return &task.Result{Success: false, Message: fmt.Sprintf("unsupported protocol: %s", job.Protocol)}, nil
	}
	return ex.Execute(ctx, job)
}
