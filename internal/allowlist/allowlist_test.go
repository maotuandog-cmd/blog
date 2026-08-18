package allowlist

import "testing"

func TestHostAllowed(t *testing.T) {
	patterns := []string{"example.com", "*.corp.local"}
	cases := []struct {
		host string
		ok   bool
	}{
		{"example.com", true},
		{"www.example.com", false},
		{"a.corp.local", true},
		{"corp.local", true},
		{"evil.com", false},
		{"", false},
	}
	for _, c := range cases {
		if got := HostAllowed(c.host, patterns); got != c.ok {
			t.Fatalf("host=%s got=%v want=%v", c.host, got, c.ok)
		}
	}
}

func TestURLAllowed(t *testing.T) {
	if err := URLAllowed("https://example.com/a", []string{"example.com"}); err != nil {
		t.Fatal(err)
	}
	if err := URLAllowed("https://evil.com", []string{"example.com"}); err == nil {
		t.Fatal("expected deny")
	}
}
