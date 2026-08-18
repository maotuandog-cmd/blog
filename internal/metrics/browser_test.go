package metrics

import (
	"testing"

	"github.com/jpsoft/hermes/internal/task"
)

func TestAppLabel(t *testing.T) {
	t.Parallel()
	job := &task.Job{Name: "fallback-name", Labels: map[string]string{"app": "portal"}}
	if got := AppLabel(job); got != "portal" {
		t.Fatalf("got %q", got)
	}
	job2 := &task.Job{Name: "only-name"}
	if got := AppLabel(job2); got != "only-name" {
		t.Fatalf("got %q", got)
	}
}

func TestObserveBrowserJourneyNoPanic(t *testing.T) {
	t.Parallel()
	job := &task.Job{
		Name:     "demo",
		Protocol: task.ProtocolBrowser,
		Labels:   map[string]string{"app": "demo"},
	}
	res := &task.Result{
		Success: true,
		Metrics: map[string]float64{
			"hermes_browser_ttfb_ms": 12,
			"hermes_browser_lcp_ms":  800,
		},
	}
	ObserveBrowserJourney(job, res)
	ObserveBrowserJourney(job, &task.Result{Success: false})
}
