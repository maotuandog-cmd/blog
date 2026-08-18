package bus

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jpsoft/hermes/internal/task"
)

func newTestBus(t *testing.T) (*RedisStream, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	s := NewRedisStreamWithDLQ(mr.Addr(), "", 0, "hermes:test:stream", "hermes:test:dlq", "hermes-test")
	if err := s.EnsureGroup(context.Background()); err != nil {
		t.Fatal(err)
	}
	return s, mr
}

func TestSaveGetJob(t *testing.T) {
	s, _ := newTestBus(t)
	ctx := context.Background()
	job := &task.Job{
		ID:       uuid.NewString(),
		Name:     "t",
		Protocol: task.ProtocolBrowser,
		Type:     "instant",
		Status:   task.StatusPending,
		Payload:  []byte(`{}`),
	}
	if err := s.SaveJob(ctx, job); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetJob(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "t" || got.Status != task.StatusPending {
		t.Fatalf("got %+v", got)
	}
}

func TestEnqueueClaimAck(t *testing.T) {
	s, _ := newTestBus(t)
	ctx := context.Background()
	job := &task.Job{
		ID:       uuid.NewString(),
		Name:     "enq",
		Protocol: task.ProtocolPing,
		Type:     "instant",
		Status:   task.StatusPending,
		Payload:  []byte(`{"host":"127.0.0.1"}`),
	}
	if _, err := s.Enqueue(ctx, job); err != nil {
		t.Fatal(err)
	}
	_ = s.SaveJob(ctx, job)

	msgs, err := s.Claim(ctx, "c1", 1, 200*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 1 || msgs[0].Job == nil || msgs[0].Job.ID != job.ID {
		t.Fatalf("claim got %#v", msgs)
	}
	if err := s.Ack(ctx, msgs[0].StreamID); err != nil {
		t.Fatal(err)
	}
}

func TestIdempotencyReserve(t *testing.T) {
	s, _ := newTestBus(t)
	ctx := context.Background()
	key := "idem-" + uuid.NewString()
	id1 := uuid.NewString()
	id2 := uuid.NewString()

	exist, created, err := s.ReserveIdempotency(ctx, key, id1, time.Hour)
	if err != nil || !created || exist != "" {
		t.Fatalf("first reserve: exist=%q created=%v err=%v", exist, created, err)
	}
	exist, created, err = s.ReserveIdempotency(ctx, key, id2, time.Hour)
	if err != nil || created || exist != id1 {
		t.Fatalf("second reserve: exist=%q created=%v err=%v", exist, created, err)
	}
}

func TestDrainModes(t *testing.T) {
	s, _ := newTestBus(t)
	ctx := context.Background()
	if err := s.SetDrainMode(ctx, "soft"); err != nil {
		t.Fatal(err)
	}
	mode, err := s.DrainMode(ctx)
	if err != nil || mode != "soft" {
		t.Fatalf("soft: %q %v", mode, err)
	}
	on, _ := s.IsDrain(ctx)
	hard, _ := s.IsHardDrain(ctx)
	if !on || hard {
		t.Fatalf("soft flags on=%v hard=%v", on, hard)
	}
	if err := s.SetDrainMode(ctx, "hard"); err != nil {
		t.Fatal(err)
	}
	hard, _ = s.IsHardDrain(ctx)
	if !hard {
		t.Fatal("expected hard")
	}
	if err := s.SetDrainMode(ctx, "off"); err != nil {
		t.Fatal(err)
	}
	on, _ = s.IsDrain(ctx)
	if on {
		t.Fatal("expected off")
	}
}

func TestScheduleDue(t *testing.T) {
	s, _ := newTestBus(t)
	ctx := context.Background()
	id := uuid.NewString()
	past := time.Now().UTC().Add(-time.Minute)
	if err := s.ScheduleAt(ctx, id, past); err != nil {
		t.Fatal(err)
	}
	ids, err := s.DueJobs(ctx, time.Now().UTC(), 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != id {
		t.Fatalf("due=%v", ids)
	}
	ids, err = s.DueJobs(ctx, time.Now().UTC(), 8)
	if err != nil || len(ids) != 0 {
		t.Fatalf("second due=%v err=%v", ids, err)
	}
}

func TestDeadLetterAndStats(t *testing.T) {
	s, _ := newTestBus(t)
	ctx := context.Background()
	job := &task.Job{
		ID:       uuid.NewString(),
		Name:     "dlq",
		Protocol: task.ProtocolBrowser,
		Type:     "instant",
		Status:   task.StatusRunning,
		Payload:  []byte(`{}`),
	}
	if err := s.DeadLetter(ctx, job, "assert failed"); err != nil {
		t.Fatal(err)
	}
	if job.Status != task.StatusFailed {
		t.Fatalf("status %s", job.Status)
	}
	st, err := s.QueueStats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if st.DLQLength < 1 {
		t.Fatalf("dlq len=%d", st.DLQLength)
	}
}
