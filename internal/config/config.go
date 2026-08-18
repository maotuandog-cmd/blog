package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds runtime settings. Secrets come from env only.
type Config struct {
	NodeID               string
	HTTPAddr             string
	RedisAddr            string
	RedisPassword        string
	RedisDB              int
	StreamKey            string
	DLQKey               string
	ConsumerGroup        string
	ConsumerName         string
	LeaseTTL             time.Duration
	ClaimMinIdle         time.Duration
	TaskTimeout          time.Duration
	MaxRetries           int
	BrowserWorkerURL     string
	BrowserMaxCount      int
	BrowserAgentMaxCount int
	AllowedHosts         []string // comma-separated HERMES_ALLOWED_HOSTS
	DefaultAntiDetect    string   // L2 | L3
	ProxyURL             string
	LLMAPIKey            string
	LLMBaseURL           string
	LLMModel             string
	APIToken             string // HERMES_API_TOKEN; empty + insecure=false => deny /v1
	APIInsecure          bool   // HERMES_API_INSECURE=true only for local dev
	HMACSecret           string // HERMES_HMAC_SECRET; when set, require X-Hermes-Signature
	SchedIntervalSec     int
	MetricsAddr          string // HERMES_METRICS_ADDR for worker-core /metrics (journey/vitals)
}

func Load() Config {
	return Config{
		NodeID:               getenv("HERMES_NODE_ID", "hermes-1"),
		HTTPAddr:             getenv("HERMES_HTTP_ADDR", ":8080"),
		RedisAddr:            getenv("HERMES_REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword:        os.Getenv("HERMES_REDIS_PASSWORD"),
		RedisDB:              getenvInt("HERMES_REDIS_DB", 0),
		StreamKey:            getenv("HERMES_STREAM_KEY", "hermes:tasks"),
		DLQKey:               getenv("HERMES_DLQ_KEY", "hermes:tasks:dlq"),
		ConsumerGroup:        getenv("HERMES_CONSUMER_GROUP", "hermes-workers"),
		ConsumerName:         getenv("HERMES_CONSUMER_NAME", ""),
		LeaseTTL:             time.Duration(getenvInt("HERMES_LEASE_TTL_SEC", 120)) * time.Second,
		ClaimMinIdle:         time.Duration(getenvInt("HERMES_CLAIM_MIN_IDLE_SEC", 120)) * time.Second,
		TaskTimeout:          time.Duration(getenvInt("HERMES_TASK_TIMEOUT_SEC", 600)) * time.Second,
		MaxRetries:           getenvInt("HERMES_MAX_RETRIES", 3),
		BrowserWorkerURL:     getenv("HERMES_BROWSER_WORKER_URL", "http://127.0.0.1:8090"),
		BrowserMaxCount:      getenvInt("HERMES_BROWSER_MAX_COUNT", 2),
		BrowserAgentMaxCount: getenvInt("HERMES_BROWSER_AGENT_MAX_COUNT", 1),
		AllowedHosts:         splitCSV(os.Getenv("HERMES_ALLOWED_HOSTS")),
		DefaultAntiDetect:    getenv("HERMES_DEFAULT_ANTI_DETECT", "L3"),
		ProxyURL:             os.Getenv("HERMES_PROXY_URL"),
		LLMAPIKey:            os.Getenv("HERMES_LLM_API_KEY"),
		LLMBaseURL:           getenv("HERMES_LLM_BASE_URL", "https://api.openai.com/v1"),
		LLMModel:             getenv("HERMES_LLM_MODEL", "gpt-4o-mini"),
		APIToken:             os.Getenv("HERMES_API_TOKEN"),
		APIInsecure:          strings.EqualFold(os.Getenv("HERMES_API_INSECURE"), "true"),
		HMACSecret:           os.Getenv("HERMES_HMAC_SECRET"),
		SchedIntervalSec:     getenvInt("HERMES_SCHED_INTERVAL_SEC", 2),
		MetricsAddr:          getenv("HERMES_METRICS_ADDR", ":8081"),
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getenvInt(k string, def int) int {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func splitCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
