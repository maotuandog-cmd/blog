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
	"github.com/jpsoft/hermes/internal/server"
)

func main() {
	cfg := config.Load()
	stream := bus.NewRedisStreamWithDLQ(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB, cfg.StreamKey, cfg.DLQKey, cfg.ConsumerGroup)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := stream.EnsureGroup(ctx); err != nil {
		log.Fatalf("redis group: %v", err)
	}
	if cfg.APIToken == "" && !cfg.APIInsecure {
		log.Printf("warning: HERMES_API_TOKEN unset — /v1 APIs will return 401 (set HERMES_API_INSECURE=true for local only)")
	}

	gw := &server.Gateway{
		Bus:          stream,
		Audit:        audit.NewStore(stream.Client(), 30*24*time.Hour),
		NodeID:       cfg.NodeID,
		AllowedHosts: cfg.AllowedHosts,
		APIToken:     cfg.APIToken,
		APIInsecure:  cfg.APIInsecure,
		HMACSecret:   cfg.HMACSecret,
	}
	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: gw.Routes()}

	go func() {
		log.Printf("gateway listening on %s", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdownCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
	defer c()
	_ = srv.Shutdown(shutdownCtx)
}
