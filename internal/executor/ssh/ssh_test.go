package sshx

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/jpsoft/hermes/internal/task"
)

func TestHostKeyCallbackKnownHosts(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "known_hosts")
	// empty file is valid for knownhosts.New
	if err := os.WriteFile(path, []byte(""), 0o600); err != nil {
		t.Fatal(err)
	}
	cb, insecure, err := hostKeyCallback(task.SSHPayload{KnownHostsFile: path})
	if err != nil {
		t.Fatal(err)
	}
	if insecure || cb == nil {
		t.Fatalf("want known_hosts callback insecure=%v", insecure)
	}
}

func TestHostKeyCallbackInsecureDefault(t *testing.T) {
	t.Setenv("HERMES_SSH_KNOWN_HOSTS", "")
	t.Setenv("HERMES_SSH_INSECURE", "")
	cb, insecure, err := hostKeyCallback(task.SSHPayload{})
	if err != nil {
		t.Fatal(err)
	}
	if !insecure || cb == nil {
		t.Fatalf("want insecure default")
	}
}
