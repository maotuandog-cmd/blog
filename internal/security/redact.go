package security

import (
	"encoding/json"
	"strings"

	"github.com/jpsoft/hermes/internal/task"
)

const Redacted = "[REDACTED]"

// RedactedJob returns a shallow copy whose payload secrets are masked.
// The original job (including Redis-stored payload) is not mutated.
func RedactedJob(job *task.Job) *task.Job {
	if job == nil {
		return nil
	}
	cp := *job
	if len(job.Payload) > 0 {
		cp.Payload = RedactPayload(job.Payload)
	}
	return &cp
}

// RedactPayload masks passwords in browser credentials, SSH fields, and fill steps.
func RedactPayload(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return raw
	}
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return raw
	}
	redactMap(m)
	out, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return out
}

func redactMap(m map[string]interface{}) {
	if m == nil {
		return
	}
	for _, k := range []string{"password", "privateKey", "passwd", "pwd"} {
		if _, ok := m[k]; ok {
			m[k] = Redacted
		}
	}
	if creds, ok := m["credentials"].(map[string]interface{}); ok {
		redactMap(creds)
	}
	if auth, ok := m["auth"].(map[string]interface{}); ok {
		redactMap(auth)
		if headers, ok := auth["headers"].(map[string]interface{}); ok {
			redactHeaders(headers)
		}
	}
	if req, ok := m["request"].(map[string]interface{}); ok {
		if headers, ok := req["headers"].(map[string]interface{}); ok {
			redactHeaders(headers)
		}
	}
	for _, key := range []string{"authSteps", "steps", "deterministic"} {
		arr, ok := m[key].([]interface{})
		if !ok {
			continue
		}
		for _, item := range arr {
			if step, ok := item.(map[string]interface{}); ok {
				redactStep(step)
			}
		}
	}
}

func redactHeaders(h map[string]interface{}) {
	for k, v := range h {
		lk := strings.ToLower(k)
		if lk == "authorization" || lk == "cookie" || strings.Contains(lk, "password") {
			h[k] = Redacted
			continue
		}
		_ = v
	}
}

func redactStep(step map[string]interface{}) {
	action, _ := step["action"].(string)
	selector, _ := step["selector"].(string)
	if !strings.EqualFold(action, "fill") {
		return
	}
	if looksLikePasswordSelector(selector) {
		if _, ok := step["value"]; ok {
			step["value"] = Redacted
		}
	}
}

func looksLikePasswordSelector(sel string) bool {
	s := strings.ToLower(sel)
	for _, n := range []string{"password", "passwd", "pwd", "pass", "密码"} {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}
