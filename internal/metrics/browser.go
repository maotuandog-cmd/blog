package metrics

import (
	"strings"
	"unicode/utf8"

	"github.com/jpsoft/hermes/internal/task"
)

// AppLabel returns a low-cardinality app label for Prometheus.
func AppLabel(job *task.Job) string {
	if job == nil {
		return "unknown"
	}
	if job.Labels != nil {
		if v := strings.TrimSpace(job.Labels["app"]); v != "" {
			return sanitizeApp(v)
		}
	}
	if v := strings.TrimSpace(job.Name); v != "" {
		return sanitizeApp(v)
	}
	return "unknown"
}

func sanitizeApp(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > 64 {
		r := []rune(s)
		s = string(r[:64])
	}
	if s == "" {
		return "unknown"
	}
	return s
}

// ObserveBrowserJourney records journey counters and optional Web Vitals histograms.
func ObserveBrowserJourney(job *task.Job, result *task.Result) {
	if job == nil || result == nil {
		return
	}
	proto := string(job.Protocol)
	if proto != string(task.ProtocolBrowser) && proto != string(task.ProtocolBrowserAgent) {
		return
	}
	app := AppLabel(job)
	success := "false"
	if result.Success {
		success = "true"
	}
	BrowserJourneyFinished.WithLabelValues(proto, success, app).Inc()

	if !result.Success || result.Metrics == nil {
		return
	}
	if v, ok := result.Metrics["hermes_browser_ttfb_ms"]; ok {
		BrowserVitalsTTFB.WithLabelValues(proto, app).Observe(v)
	}
	if v, ok := result.Metrics["hermes_browser_fcp_ms"]; ok {
		BrowserVitalsFCP.WithLabelValues(proto, app).Observe(v)
	}
	if v, ok := result.Metrics["hermes_browser_lcp_ms"]; ok {
		BrowserVitalsLCP.WithLabelValues(proto, app).Observe(v)
	}
	if v, ok := result.Metrics["hermes_browser_tbt_ms"]; ok {
		BrowserVitalsTBT.WithLabelValues(proto, app).Observe(v)
	}
}
