package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jpsoft/hermes/internal/bus"
	"github.com/jpsoft/hermes/internal/config"
	"github.com/jpsoft/hermes/internal/scheduler"
)

func main() {
	cfg := config.Load()
	stream := bus.NewRedisStreamWithDLQ(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB, cfg.StreamKey, cfg.DLQKey, cfg.ConsumerGroup)
	ctx := context.Background()
	if err := stream.EnsureGroup(ctx); err != nil {
		log.Fatalf("redis group: %v", err)
	}

	runCtx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	sched := &scheduler.Timed{
		Bus:      stream,
		Interval: time.Duration(cfg.SchedIntervalSec) * time.Second,
		Batch:    32,
	}
	go sched.Loop(runCtx)

	log.Printf("dispatcher (timed scheduler) started node=%s interval=%ds", cfg.NodeID, cfg.SchedIntervalSec)
	<-runCtx.Done()
	log.Println("dispatcher stopped")
	os.Exit(0)
}
