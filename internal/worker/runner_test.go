package worker

import (
	"testing"

	"github.com/jpsoft/hermes/internal/task"
)

func TestResultRetryable(t *testing.T) {
	t.Parallel()
	f := false
	tr := true
	cases := []struct {
		name string
		in   *task.Result
		want bool
	}{
		{"nil result", nil, true},
		{"nil flag", &task.Result{Success: false}, true},
		{"explicit false", &task.Result{Success: false, Retryable: &f}, false},
		{"explicit true", &task.Result{Success: false, Retryable: &tr}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resultRetryable(tc.in); got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}
