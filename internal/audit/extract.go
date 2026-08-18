package audit

import (
	"encoding/json"
	"strings"

	"github.com/jpsoft/hermes/internal/task"
)

// AssetFromJob extracts a best-effort target asset for audit.
func AssetFromJob(job *task.Job) string {
	if job == nil || len(job.Payload) == 0 {
		return ""
	}
	var m map[string]interface{}
	if err := json.Unmarshal(job.Payload, &m); err != nil {
		return ""
	}
	for _, k := range []string{"host", "url", "startUrl", "target"} {
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	if req, ok := m["request"].(map[string]interface{}); ok {
		if u, ok := req["url"].(string); ok {
			return u
		}
	}
	if cmds, ok := m["commands"].([]interface{}); ok && len(cmds) > 0 {
		if c, ok := cmds[0].(string); ok {
			return truncate(c, 120)
		}
	}
	return ""
}

func PurposeFromJob(job *task.Job) string {
	if job == nil || len(job.Payload) == 0 {
		return ""
	}
	var m map[string]interface{}
	if err := json.Unmarshal(job.Payload, &m); err != nil {
		return ""
	}
	if p, ok := m["purpose"].(string); ok {
		return p
	}
	return ""
}

func ActorFromLabels(labels map[string]string, fallback string) string {
	if labels != nil {
		for _, k := range []string{"actor", "user", "submittedBy"} {
			if v := strings.TrimSpace(labels[k]); v != "" {
				return v
			}
		}
	}
	if fallback == "" {
		return "api"
	}
	return fallback
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
