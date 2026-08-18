package sshx

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/jpsoft/hermes/internal/task"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type Executor struct{}

func New() *Executor { return &Executor{} }

func (e *Executor) Protocol() task.Protocol { return task.ProtocolSSH }

func (e *Executor) Execute(ctx context.Context, job *task.Job) (*task.Result, error) {
	var p task.SSHPayload
	if err := json.Unmarshal(job.Payload, &p); err != nil {
		return fail("invalid ssh payload: " + err.Error()), nil
	}
	if p.Port == 0 {
		p.Port = 22
	}
	if len(p.Commands) == 0 {
		return fail("no commands"), nil
	}

	auth, err := buildAuth(p)
	if err != nil {
		return fail(err.Error()), nil
	}
	hkcb, insecure, err := hostKeyCallback(p)
	if err != nil {
		return fail(err.Error()), nil
	}
	cfg := &ssh.ClientConfig{
		User:            p.Username,
		Auth:            auth,
		HostKeyCallback: hkcb,
		Timeout:         20 * time.Second,
	}

	start := time.Now()
	addr := net.JoinHostPort(p.Host, fmt.Sprintf("%d", p.Port))
	client, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return fail("ssh dial: " + err.Error()), nil
	}
	defer client.Close()

	var steps []task.StepResult
	ok := true
	for i, cmd := range p.Commands {
		select {
		case <-ctx.Done():
			return fail("context cancelled"), ctx.Err()
		default:
		}
		st := runCommand(client, fmt.Sprintf("cmd-%d", i+1), cmd)
		steps = append(steps, st)
		if !st.Success {
			ok = false
			break
		}
	}
	extra := map[string]interface{}{}
	if insecure {
		extra["hostKey"] = "insecure_skip"
	} else {
		extra["hostKey"] = "known_hosts"
	}
	return &task.Result{
		Success:    ok,
		DurationMs: time.Since(start).Milliseconds(),
		Steps:      steps,
		Message:    ternary(ok, "ok", "command failed"),
		Extra:      extra,
	}, nil
}

func hostKeyCallback(p task.SSHPayload) (ssh.HostKeyCallback, bool, error) {
	path := strings.TrimSpace(p.KnownHostsFile)
	if path == "" {
		path = strings.TrimSpace(os.Getenv("HERMES_SSH_KNOWN_HOSTS"))
	}
	if path != "" {
		cb, err := knownhosts.New(path)
		return cb, false, err
	}
	insecure := p.InsecureSkipHostKey || strings.EqualFold(os.Getenv("HERMES_SSH_INSECURE"), "true")
	// Backward compatible default: skip verification unless known_hosts configured.
	if !insecure && path == "" {
		insecure = true
	}
	if insecure {
		return ssh.InsecureIgnoreHostKey(), true, nil
	}
	return nil, false, fmt.Errorf("set knownHostsFile / HERMES_SSH_KNOWN_HOSTS or insecureSkipHostKey")
}

func runCommand(client *ssh.Client, name, cmd string) task.StepResult {
	start := time.Now()
	session, err := client.NewSession()
	if err != nil {
		return task.StepResult{Name: name, Success: false, Error: err.Error(), DurationMs: time.Since(start).Milliseconds()}
	}
	defer session.Close()
	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr
	err = session.Run(cmd)
	out := strings.TrimSpace(stdout.String())
	if stderr.Len() > 0 {
		if out != "" {
			out += "\n"
		}
		out += strings.TrimSpace(stderr.String())
	}
	if len(out) > 64*1024 {
		out = out[:64*1024] + "...(truncated)"
	}
	sr := task.StepResult{Name: name, Output: out, DurationMs: time.Since(start).Milliseconds(), Success: err == nil}
	if err != nil {
		sr.Error = err.Error()
	}
	return sr
}

func buildAuth(p task.SSHPayload) ([]ssh.AuthMethod, error) {
	if p.PrivateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(p.PrivateKey))
		if err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	}
	if p.Password != "" {
		return []ssh.AuthMethod{ssh.Password(p.Password)}, nil
	}
	return nil, fmt.Errorf("password or privateKey required")
}

func fail(msg string) *task.Result {
	return &task.Result{Success: false, Message: msg}
}

func ternary(c bool, a, b string) string {
	if c {
		return a
	}
	return b
}
