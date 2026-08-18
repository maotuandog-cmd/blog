package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	JobsEnqueued = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "hermes_jobs_enqueued_total",
		Help: "Jobs enqueued",
	}, []string{"protocol"})

	JobsFinished = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "hermes_jobs_finished_total",
		Help: "Jobs finished",
	}, []string{"protocol", "success"})

	JobDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "hermes_job_duration_seconds",
		Help:    "Job duration seconds",
		Buckets: prometheus.DefBuckets,
	}, []string{"protocol"})

	AgentActive = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "hermes_browser_agent_active",
		Help: "Active browser agent jobs on this node",
	})

	AgentDenied = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "hermes_browser_agent_denied_total",
		Help: "Browser agent tasks denied (allowlist/quota/validation)",
	}, []string{"reason"})

	JobsDeadLetter = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "hermes_jobs_dead_letter_total",
		Help: "Jobs moved to dead-letter queue after max retries",
	}, []string{"protocol"})

	JobsReclaimed = promauto.NewCounter(prometheus.CounterOpts{
		Name: "hermes_jobs_reclaimed_total",
		Help: "Pending stream messages reclaimed via XAUTOCLAIM",
	})

	JobsScheduled = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "hermes_jobs_scheduled_fired_total",
		Help: "Timed jobs moved from schedule ZSET to stream",
	}, []string{"protocol"})

	HMACRejected = promauto.NewCounter(prometheus.CounterOpts{
		Name: "hermes_hmac_rejected_total",
		Help: "Jobs rejected due to missing/invalid HMAC signature",
	})

	BrowserPoolActive = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "hermes_browser_pool_active",
		Help: "Active browser pool slots",
	}, []string{"pool"})

	BrowserPoolWaiting = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "hermes_browser_pool_waiting",
		Help: "Tasks waiting for a browser pool slot",
	}, []string{"pool"})

	BrowserQuotaTimeout = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "hermes_browser_quota_timeout_total",
		Help: "Tasks that timed out waiting for browser quota",
	}, []string{"pool"})

	AuditWritten = promauto.NewCounter(prometheus.CounterOpts{
		Name: "hermes_audit_written_total",
		Help: "Audit events appended",
	})

	BrowserJourneyFinished = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "hermes_browser_journey_finished_total",
		Help: "Browser journey terminal outcomes",
	}, []string{"protocol", "success", "app"})

	BrowserVitalsTTFB = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "hermes_browser_vitals_ttfb_milliseconds",
		Help:    "Browser TTFB from collectWebVitals",
		Buckets: []float64{50, 100, 200, 400, 800, 1600, 3200, 6400},
	}, []string{"protocol", "app"})

	BrowserVitalsFCP = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "hermes_browser_vitals_fcp_milliseconds",
		Help:    "Browser FCP from collectWebVitals",
		Buckets: []float64{100, 250, 500, 1000, 1800, 3000, 5000, 10000},
	}, []string{"protocol", "app"})

	BrowserVitalsLCP = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "hermes_browser_vitals_lcp_milliseconds",
		Help:    "Browser LCP from collectWebVitals",
		Buckets: []float64{250, 500, 1000, 1800, 2500, 4000, 8000, 15000},
	}, []string{"protocol", "app"})

	BrowserVitalsTBT = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "hermes_browser_vitals_tbt_milliseconds",
		Help:    "Browser TBT from collectWebVitals",
		Buckets: []float64{50, 100, 200, 400, 800, 1600, 3000},
	}, []string{"protocol", "app"})
)

func Handler() http.Handler { return promhttp.Handler() }
