package allowlist

import (
	"fmt"
	"net/url"
	"strings"
)

// HostAllowed returns true if host matches any pattern (exact or *.suffix).
func HostAllowed(host string, patterns []string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return false
	}
	if i := strings.Index(host, ":"); i >= 0 {
		host = host[:i]
	}
	if len(patterns) == 0 {
		return false
	}
	for _, p := range patterns {
		p = strings.ToLower(strings.TrimSpace(p))
		if p == "" {
			continue
		}
		if strings.HasPrefix(p, "*.") {
			suf := strings.TrimPrefix(p, "*.")
			if host == suf || strings.HasSuffix(host, "."+suf) {
				return true
			}
			continue
		}
		if host == p {
			return true
		}
	}
	return false
}

// URLAllowed parses rawURL and checks host against patterns.
func URLAllowed(raw string, patterns []string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("unsupported scheme: %s", u.Scheme)
	}
	if !HostAllowed(u.Host, patterns) {
		return fmt.Errorf("host not in allowlist: %s", u.Host)
	}
	return nil
}

// Merge intersects task allowlist with node allowlist.
// Empty task list => node list. Empty node list => deny-all (nil).
func Merge(nodePatterns, taskPatterns []string) []string {
	if len(nodePatterns) == 0 {
		return nil
	}
	if len(taskPatterns) == 0 {
		return append([]string(nil), nodePatterns...)
	}
	out := make([]string, 0, len(taskPatterns))
	for _, t := range taskPatterns {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		// Keep task pattern only if it is covered by node policy.
		sample := t
		if strings.HasPrefix(t, "*.") {
			sample = strings.TrimPrefix(t, "*.")
		}
		if HostAllowed(sample, nodePatterns) || containsFold(nodePatterns, t) {
			out = append(out, t)
		}
	}
	return out
}

func containsFold(list []string, v string) bool {
	for _, x := range list {
		if strings.EqualFold(x, v) {
			return true
		}
	}
	return false
}
