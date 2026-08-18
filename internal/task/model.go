package task

import (
	"encoding/json"
	"time"
)

type Status string

const (
	StatusPending   Status = "PENDING"
	StatusClaimed   Status = "CLAIMED"
	StatusRunning   Status = "RUNNING"
	StatusSuccess   Status = "SUCCESS"
	StatusFailed    Status = "FAILED"
	StatusRetryWait Status = "RETRY_WAIT"
	StatusCancelled Status = "CANCELLED"
)

type Protocol string

const (
	ProtocolSSH          Protocol = "SSH"
	ProtocolAPI          Protocol = "API"
	ProtocolBrowser      Protocol = "BROWSER"
	ProtocolBrowserAgent Protocol = "BROWSER_AGENT" // P1
	ProtocolPing         Protocol = "PING"          // P1 F-TOOL-01
)

// Job is the Hermes canonical task model (independent from legacy queues).
type Job struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	Protocol       Protocol          `json:"protocol"`
	Type           string            `json:"type"` // instant | timed
	Status         Status            `json:"status"`
	Payload        json.RawMessage   `json:"payload"`
	Labels         map[string]string `json:"labels,omitempty"`
	MaxRetries     int               `json:"maxRetries"`
	Retries        int               `json:"retries"`
	TimeoutSec     int               `json:"timeoutSec"`
	NodeID         string            `json:"nodeId,omitempty"`
	LeaseUntil     *time.Time        `json:"leaseUntil,omitempty"`
	IdempotencyKey string            `json:"idempotencyKey,omitempty"`
	TraceID        string            `json:"traceId,omitempty"`
	RunAt          *time.Time        `json:"runAt,omitempty"` // timed jobs: UTC schedule time
	CreatedAt      time.Time         `json:"createdAt"`
	UpdatedAt      time.Time         `json:"updatedAt"`
	Result         *Result           `json:"result,omitempty"`
}

type Result struct {
	Success    bool                   `json:"success"`
	Message    string                 `json:"message,omitempty"`
	DurationMs int64                  `json:"durationMs"`
	Steps      []StepResult           `json:"steps,omitempty"`
	Metrics    map[string]float64     `json:"metrics,omitempty"`
	Artifacts  map[string]string      `json:"artifacts,omitempty"`
	Extra      map[string]interface{} `json:"extra,omitempty"`
	// Retryable: nil = default (retry until MaxRetries); false = terminal FAIL immediately.
	Retryable *bool `json:"retryable,omitempty"`
}

type StepResult struct {
	Name       string `json:"name"`
	Success    bool   `json:"success"`
	Output     string `json:"output,omitempty"`
	Error      string `json:"error,omitempty"`
	DurationMs int64  `json:"durationMs"`
}

// SSHPayload for ProtocolSSH.
type SSHPayload struct {
	Host                string   `json:"host"`
	Port                int      `json:"port"`
	Username            string   `json:"username"`
	Password            string   `json:"password,omitempty"`
	PrivateKey          string   `json:"privateKey,omitempty"`
	Commands            []string `json:"commands"`
	KnownHostsFile      string   `json:"knownHostsFile,omitempty"`      // OpenSSH known_hosts path (D08)
	InsecureSkipHostKey bool     `json:"insecureSkipHostKey,omitempty"` // explicit skip (default if no known_hosts)
}

// APIPayload for ProtocolAPI.
type APIPayload struct {
	Auth    *APIRequest `json:"auth,omitempty"`
	Request APIRequest  `json:"request"`
}

type APIRequest struct {
	Method         string            `json:"method"`
	URL            string            `json:"url"`
	Headers        map[string]string `json:"headers,omitempty"`
	Body           string            `json:"body,omitempty"`
	TimeoutSec     int               `json:"timeoutSec,omitempty"`
	ExpectStatus   []int             `json:"expectStatus,omitempty"`
	ExpectContains string            `json:"expectContains,omitempty"`
}

// BrowserCredentials is injected at probe time (not expanded into fill steps on submit).
type BrowserCredentials struct {
	Username        string `json:"username,omitempty"`
	Password        string `json:"password,omitempty"`
	LoginURL        string `json:"loginUrl,omitempty"`
	UserSelector    string `json:"userSelector,omitempty"`
	PassSelector    string `json:"passSelector,omitempty"`
	SubmitSelector  string `json:"submitSelector,omitempty"`
	CaptchaSelector string `json:"captchaSelector,omitempty"`
}

// BrowserPayload for ProtocolBrowser (deterministic journey).
type BrowserPayload struct {
	Locale              string              `json:"locale,omitempty"`
	Credentials         *BrowserCredentials `json:"credentials,omitempty"` // F-SEC-02: password redacted on read APIs
	AutoCaptcha         *bool               `json:"autoCaptcha,omitempty"` // nil = default true
	AuthSteps           []BrowserStep       `json:"authSteps,omitempty"`   // F-BRW-02: auth segment; fail stops before business
	Steps               []BrowserStep       `json:"steps"`                 // business segment
	CollectResources    bool                `json:"collectResources,omitempty"`
	CollectWebVitals    bool                `json:"collectWebVitals,omitempty"`
	CaptureTrace        string              `json:"captureTrace,omitempty"`
	CollectMode         string              `json:"collectMode,omitempty"` // afterAuth | all
	ResourceDetail      bool                `json:"resourceDetail,omitempty"`
	ResourceDetailLimit int                 `json:"resourceDetailLimit,omitempty"`
	ResourceSettleMs    int                 `json:"resourceSettleMs,omitempty"`
	WaitNetworkIdle     bool                `json:"waitNetworkIdle,omitempty"`
}

type BrowserStep struct {
	Action     string  `json:"action"` // navigate|fill|click|wait|assertText|screenshot|drag|solveCaptcha
	URL        string  `json:"url,omitempty"`
	Selector   string  `json:"selector,omitempty"`
	Value      string  `json:"value,omitempty"`
	Kind       string  `json:"kind,omitempty"` // solveCaptcha: auto|image|click|slider
	TimeoutSec int     `json:"timeoutSec,omitempty"`
	ToX        float64 `json:"toX,omitempty"`
	DeltaX     float64 `json:"deltaX,omitempty"`
	DeltaY     float64 `json:"deltaY,omitempty"`
}

// BrowserAgentPayload for ProtocolBrowserAgent (P1 LLM journey).
type BrowserAgentPayload struct {
	Goal                string                 `json:"goal"`
	StartURL            string                 `json:"startUrl"`
	AllowedHosts        []string               `json:"allowedHosts,omitempty"` // task-level allowlist; intersects node allowlist
	Locale              string                 `json:"locale,omitempty"`
	MaxSteps            int                    `json:"maxSteps,omitempty"`
	AntiDetect          string                 `json:"antiDetect,omitempty"` // L2 | L3 (default L3)
	ProxyURL            string                 `json:"proxyUrl,omitempty"`   // optional override
	ExtractSchema       map[string]interface{} `json:"extractSchema,omitempty"`
	Deterministic       []BrowserStep          `json:"deterministic,omitempty"` // hybrid: run before agent loop
	Summarize           bool                   `json:"summarize"`               // default true when omitted via worker
	Purpose             string                 `json:"purpose,omitempty"`       // audit declaration
	CollectResources    bool                   `json:"collectResources,omitempty"`
	ResourceDetail      bool                   `json:"resourceDetail,omitempty"`
	ResourceDetailLimit int                    `json:"resourceDetailLimit,omitempty"`
	ResourceSettleMs    int                    `json:"resourceSettleMs,omitempty"`
	WaitNetworkIdle     bool                   `json:"waitNetworkIdle,omitempty"`
}
