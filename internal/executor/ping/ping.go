package ping

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/jpsoft/hermes/internal/task"
)

// Executor runs ICMP ping (F-TOOL-01).
type Executor struct{}

func New() *Executor { return &Executor{} }

func (e *Executor) Protocol() task.Protocol { return task.ProtocolPing }

type payload struct {
	Host       string `json:"host"`
	Count      int    `json:"count"`
	TimeoutSec int    `json:"timeoutSec"`
}

func (e *Executor) Execute(ctx context.Context, job *task.Job) (*task.Result, error) {
	var p payload
	if err := json.Unmarshal(job.Payload, &p); err != nil {
		return &task.Result{Success: false, Message: "invalid ping payload: " + err.Error()}, nil
	}
	host := strings.TrimSpace(p.Host)
	if host == "" {
		return &task.Result{Success: false, Message: "host required"}, nil
	}
	count := p.Count
	if count <= 0 {
		count = 4
	}
	if count > 20 {
		count = 20
	}
	timeout := 30 * time.Second
	if p.TimeoutSec > 0 {
		timeout = time.Duration(p.TimeoutSec) * time.Second
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	start := time.Now()
	args := pingArgs(host, count)
	cmd := exec.CommandContext(cctx, args[0], args[1:]...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	out := strings.TrimSpace(stdout.String())
	if stderr.Len() > 0 {
		if out != "" {
			out += "\n"
		}
		out += strings.TrimSpace(stderr.String())
	}
	if len(out) > 32*1024 {
		out = out[:32*1024] + "...(truncated)"
	}
	ok := err == nil
	msg := "ok"
	if !ok {
		msg = fmt.Sprintf("ping failed: %v", err)
	}
	return &task.Result{
		Success:    ok,
		Message:    msg,
		DurationMs: time.Since(start).Milliseconds(),
		Steps: []task.StepResult{{
			Name:       "ping",
			Success:    ok,
			Output:     out,
			Error:      ternary(!ok, msg, ""),
			DurationMs: time.Since(start).Milliseconds(),
		}},
		Metrics: map[string]float64{
			"hermes_ping_count": float64(count),
		},
		Extra: map[string]interface{}{
			"host":  host,
			"count": count,
		},
	}, nil
}

func pingArgs(host string, count int) []string {
	n := strconv.Itoa(count)
	if runtime.GOOS == "windows" {
		return []string{"ping", "-n", n, host}
	}
	// Linux / Darwin
	return []string{"ping", "-c", n, host}
}

func ternary(c bool, a, b string) string {
	if c {
		return a
	}
	return b
}
