package security

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/jpsoft/hermes/internal/task"
)

func TestRedactPayloadCredentials(t *testing.T) {
	raw := json.RawMessage(`{"credentials":{"username":"alice","password":"s3cret"},"steps":[{"action":"navigate","url":"http://x"}]}`)
	got := RedactPayload(raw)
	if strings.Contains(string(got), "s3cret") {
		t.Fatalf("password leaked: %s", got)
	}
	if !strings.Contains(string(got), `"alice"`) {
		t.Fatalf("username should remain: %s", got)
	}
	if !strings.Contains(string(got), Redacted) {
		t.Fatalf("want redacted marker: %s", got)
	}
	if strings.Contains(string(raw), Redacted) {
		t.Fatal("original payload mutated")
	}
}

func TestRedactFillPasswordStep(t *testing.T) {
	raw := json.RawMessage(`{"authSteps":[{"action":"fill","selector":"#pass","value":"hunter2"},{"action":"fill","selector":"#user","value":"bob"}]}`)
	got := RedactPayload(raw)
	if strings.Contains(string(got), "hunter2") {
		t.Fatalf("fill password leaked: %s", got)
	}
	if !strings.Contains(string(got), `"bob"`) {
		t.Fatalf("username fill should remain: %s", got)
	}
}

func TestRedactedJobDoesNotMutate(t *testing.T) {
	job := &task.Job{
		ID:       "j1",
		Payload:  json.RawMessage(`{"password":"ssh-pass","credentials":{"password":"web-pass"}}`),
		Protocol: task.ProtocolBrowser,
	}
	out := RedactedJob(job)
	if strings.Contains(string(out.Payload), "web-pass") || strings.Contains(string(out.Payload), "ssh-pass") {
		t.Fatalf("leaked in copy: %s", out.Payload)
	}
	if !strings.Contains(string(job.Payload), "web-pass") {
		t.Fatal("stored payload should keep plaintext")
	}
}
