package audit

import (
	"encoding/json"
	"testing"

	"github.com/jpsoft/hermes/internal/task"
)

func TestAssetFromJob(t *testing.T) {
	job := &task.Job{Payload: json.RawMessage(`{"host":"1.2.3.4","commands":["uptime"]}`)}
	if got := AssetFromJob(job); got != "1.2.3.4" {
		t.Fatalf("got %q", got)
	}
	job2 := &task.Job{Payload: json.RawMessage(`{"request":{"url":"https://example.com/a"}}`)}
	if got := AssetFromJob(job2); got != "https://example.com/a" {
		t.Fatalf("got %q", got)
	}
}

func TestActorFromLabels(t *testing.T) {
	if got := ActorFromLabels(map[string]string{"actor": "ops"}, "api"); got != "ops" {
		t.Fatalf("got %q", got)
	}
	if got := ActorFromLabels(nil, "api"); got != "api" {
		t.Fatalf("got %q", got)
	}
}
