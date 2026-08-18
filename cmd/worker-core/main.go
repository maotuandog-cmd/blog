package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jpsoft/hermes/internal/audit"
	"github.com/jpsoft/hermes/internal/bus"
	"github.com/jpsoft/hermes/internal/config"
	"github.com/jpsoft/hermes/internal/executor"
	apiExec "github.com/jpsoft/hermes/internal/executor/api"
	browserExec "github.com/jpsoft/hermes/internal/executor/browser"
	pingExec "github.com/jpsoft/hermes/internal/executor/ping"
	sshExec "github.com/jpsoft/hermes/internal/executor/ssh"
	"github.com/jpsoft/hermes/internal/lease"
	"github.com/jpsoft/hermes/internal/metrics"
	"github.com/jpsoft/hermes/internal/worker"
)

func main() {
	cfg := config.Load()
	consumer := cfg.ConsumerName
	if consumer == "" {
		consumer = cfg.NodeID + "-core"
	}
	stream := bus.NewRedisStreamWithDLQ(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB, cfg.StreamKey, cfg.DLQKey, cfg.ConsumerGroup)
	if err := stream.EnsureGroup(context.Background()); err != nil {
		log.Fatalf("redis group: %v", err)
	}

	browserBase := browserExec.New(browserExec.Options{
		BaseURL:           cfg.BrowserWorkerURL,
		NodeAllowHosts:    cfg.AllowedHosts,
		DefaultAntiDetect: cfg.DefaultAntiDetect,
		ProxyURL:          cfg.ProxyURL,
		BrowserMaxCount:   cfg.BrowserMaxCount,
		AgentMaxCount:     cfg.BrowserAgentMaxCount,
		LLMAPIKey:         cfg.LLMAPIKey,
		LLMBaseURL:        cfg.LLMBaseURL,
		LLMModel:          cfg.LLMModel,
	})

	reg := executor.NewRegistry(
		sshExec.New(),
		apiExec.New(),
		browserBase,
		&browserExec.AgentExecutor{Executor: browserBase},
		pingExec.New(),
	)
	runner := &worker.Runner{
		Bus:       stream,
		Lease:     lease.NewManager(stream.Client(), cfg.LeaseTTL),
		Registry:  reg,
		Audit:     audit.NewStore(stream.Client(), 30*24*time.Hour),
		NodeID:    cfg.NodeID,
		Consumer:  consumer,
		Timeout:   cfg.TaskTimeout,
		MaxRetry:  cfg.MaxRetries,
		ClaimIdle: cfg.ClaimMinIdle,
	}

	if cfg.MetricsAddr != "" && cfg.MetricsAddr != "-" {
		mux := http.NewServeMux()
		mux.Handle("/metrics", metrics.Handler())
		mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok"))
		})
		go func() {
			log.Printf("worker-core metrics on %s", cfg.MetricsAddr)
			if err := http.ListenAndServe(cfg.MetricsAddr, mux); err != nil {
				log.Printf("worker-core metrics server: %v", err)
			}
		}()
	}

	runCtx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	log.Printf("worker-core listening as %s allowHosts=%v antiDetect=%s browserMax=%d agentMax=%d",
		consumer, cfg.AllowedHosts, cfg.DefaultAntiDetect, cfg.BrowserMaxCount, cfg.BrowserAgentMaxCount)
	runner.Loop(runCtx)
	os.Exit(0)
}
