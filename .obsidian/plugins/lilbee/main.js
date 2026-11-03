"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target2, all) => {
  for (var name in all)
    __defProp(target2, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  FileProgressTracker: () => FileProgressTracker,
  batchUploads: () => batchUploads,
  default: () => LilbeePlugin,
  parseAddDoneEvent: () => parseAddDoneEvent
});
module.exports = __toCommonJS(main_exports);
var import_obsidian32 = require("obsidian");

// src/types.ts
var CLAIM_TYPE = {
  FACT: "fact",
  INFERENCE: "inference"
};
var REQUEST_OUTCOME = {
  OK: "ok",
  AUTH_ERROR: "auth_error",
  SERVER_ERROR: "server_error",
  UNREACHABLE: "unreachable",
  STARTING: "starting"
};
var CRAWL_RENDER_MODE = {
  HTTP: "http",
  BROWSER: "browser"
};
var KV_CACHE_TYPE = {
  F16: "f16",
  F32: "f32",
  Q8_0: "q8_0",
  Q4_0: "q4_0"
};
var CONFIG_KEY = {
  RAG_SYSTEM_PROMPT: "rag_system_prompt",
  GENERAL_SYSTEM_PROMPT: "general_system_prompt",
  CHAT_MODE: "chat_mode",
  SHOW_REASONING: "show_reasoning",
  CHAT_COMPACTION: "chat_compaction",
  CRAWL_RENDER_MODE: "crawl_render_mode"
};
var CHAT_MODE = {
  SEARCH: "search",
  CHAT: "chat"
};
var CATALOG_SOURCE = {
  NATIVE: "native",
  FRONTIER: "frontier",
  OLLAMA: "ollama",
  LM_STUDIO: "lm_studio"
};
var HOSTED_SOURCES = /* @__PURE__ */ new Set([
  CATALOG_SOURCE.FRONTIER,
  CATALOG_SOURCE.OLLAMA,
  CATALOG_SOURCE.LM_STUDIO
]);
var KEY_STATUS = {
  READY: "ready",
  MISSING_KEY: "missing_key"
};
var CAPABILITY = {
  API_KEYS: "api_keys",
  CRAWLING: "crawling",
  WIKI: "wiki"
};
var CATALOG_TAB = {
  DISCOVER: "discover",
  CHAT: "chat",
  EMBED: "embed",
  VISION: "vision",
  RERANK: "rerank",
  LIBRARY: "library"
};
var HARDWARE_FIT = {
  FITS: "fits",
  TIGHT: "tight",
  WONT_RUN: "wont_run"
};
var MODEL_COMPAT = {
  SUPPORTED: "supported",
  UNSUPPORTED: "unsupported",
  UNKNOWN: "unknown"
};
var SESSION_ROLE = {
  USER: "user",
  ASSISTANT: "assistant"
};
var SERVER_STATE = {
  STOPPED: "stopped",
  DOWNLOADING: "downloading",
  STARTING: "starting",
  READY: "ready",
  ERROR: "error"
};
var MANAGED_PHASE = {
  DOWNLOADING: "downloading",
  STARTING: "starting",
  READY: "ready",
  ERROR: "error"
};
var SERVER_MODE = {
  MANAGED: "managed",
  EXTERNAL: "external"
};
var MANAGED_CONSENT_RESULT = {
  DOWNLOAD: "download",
  EXTERNAL: "external",
  CANCEL: "cancel"
};
var SETUP_OUTCOME = {
  STARTED: "started",
  SWITCHED_TO_EXTERNAL: "switched-to-external",
  CANCELED: "canceled"
};
var SEARCH_CHUNK_TYPE = {
  ALL: "all",
  WIKI: "wiki",
  RAW: "raw"
};
var MEMORY_KIND = {
  FACT: "fact",
  PREFERENCE: "preference"
};
var MEMORY_CONFIG_KEY = {
  ENABLED: "memory_enabled",
  AUTO_EXTRACT: "memory_auto_extract"
};
var AGENT_CLIENT = {
  CLAUDE: "claude",
  HERMES: "hermes",
  OPENCODE: "opencode"
};
var AGENT_CLIENTS = [AGENT_CLIENT.CLAUDE, AGENT_CLIENT.HERMES, AGENT_CLIENT.OPENCODE];
var AGENT_SELECTION = {
  NONE: "none",
  CLAUDE: "claude",
  HERMES: "hermes",
  OPENCODE: "opencode"
};
var DEFAULT_AGENT_INTEGRATION = {
  agent: "none",
  keepConfigFresh: true,
  pickerShown: false
};
var AGENT_MIN_CONTEXT_TOKENS = 2e4;
var DEFAULT_SETTINGS = {
  serverUrl: "http://127.0.0.1:7433",
  // Match the server's default retrieval depth (core config top_k = 12) so the
  // plugin and a bare `lilbee serve` behave identically out of the box.
  topK: 12,
  maxDistance: 0.9,
  adaptiveThreshold: false,
  serverMode: "managed",
  ragSystemPrompt: "",
  generalSystemPrompt: "",
  setupCompleted: false,
  wikiEnabled: false,
  wikiPruneRaw: false,
  wikiFaithfulnessThreshold: 0.7,
  searchChunkType: "raw",
  // On, but only reached once the wiki itself is enabled (which is opt-in).
  // A wiki you cannot open in the vault is most of the point missing: these
  // pages carry [[wikilinks]], so as vault notes they get Obsidian's graph,
  // backlinks and click-through for free.
  wikiSyncToVault: true,
  wikiVaultFolder: "lilbee-wiki",
  manualToken: "",
  storeContentInVault: true,
  lastCatalogTab: "discover",
  sharedRoot: "",
  reasoningDefaulted: false,
  includeDevBuilds: false,
  agentIntegration: { ...DEFAULT_AGENT_INTEGRATION }
};
var DEFAULT_SHARED_CONFIG = {
  lilbeeVersion: "",
  lilbeeVariant: "",
  hfToken: "",
  lastUpdateCheckPluginVersion: "",
  serverAutoUpdate: true,
  serverUninstalled: false
};
var UNINSTALL_TARGET = {
  BINARY: "binary",
  MODELS: "models",
  INDEX: "index"
};
var VERSION_ACTION = {
  INSTALL: "install",
  REINSTALL: "reinstall",
  UPDATE: "update",
  DOWNGRADE: "downgrade"
};
var SHARED_PATH = {
  BIN: "bin",
  MODELS: "models",
  VAULTS: "vaults",
  CONFIG: "config.json",
  REGISTRY: "registry.json"
};
var LOGS_DIR = "logs";
var LOG_FILE = {
  SERVER: "server.log",
  FAULT: "server-fault.log",
  SPAWN_CRASH: "spawn-crash.log",
  PLUGIN: "plugin.log"
};
var SSE_EVENT = {
  TOKEN: "token",
  REASONING: "reasoning",
  SOURCES: "sources",
  DONE: "done",
  ERROR: "error",
  COMPACTING: "compacting",
  COMPACTION: "compaction",
  WARMING: "warming",
  PROGRESS: "progress",
  MESSAGE: "message",
  FILE_START: "file_start",
  EXTRACT: "extract",
  EMBED: "embed",
  FILE_DONE: "file_done",
  PULL: "pull",
  CRAWL_START: "crawl_start",
  CRAWL_PAGE: "crawl_page",
  CRAWL_DONE: "crawl_done",
  CRAWL_ERROR: "crawl_error",
  WIKI_PHASE: "wiki_phase",
  WIKI_PAGE: "wiki_page",
  SETUP_START: "setup_start",
  SETUP_PROGRESS: "setup_progress",
  SETUP_DONE: "setup_done",
  ALREADY_INGESTING: "already_ingesting",
  BATCH_PROGRESS: "batch_progress",
  MEMORY_EXTRACTED: "memory_extracted",
  GPU_STATS: "gpu_stats"
};
var JSON_HEADERS = { "Content-Type": "application/json" };
var OCTET_STREAM_HEADERS = { "Content-Type": "application/octet-stream" };
function bearerHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}
var CONTENT_TYPE = {
  PDF: "application/pdf",
  PDF_SHORT: "pdf",
  MARKDOWN: "text/markdown",
  HTML: "text/html"
};
function isPdfContentType(value) {
  return value === CONTENT_TYPE.PDF || value === CONTENT_TYPE.PDF_SHORT;
}
var DATASET_FORMAT = {
  PARQUET: "parquet",
  JSONL: "jsonl"
};
var TABLE_MODEL = {
  DISABLED: "disabled",
  TATR: "tatr",
  SLANET_AUTO: "slanet_auto",
  SLANET_PLUS: "slanet_plus",
  SLANET_WIRED: "slanet_wired",
  SLANET_WIRELESS: "slanet_wireless"
};
var WIKI_PAGE_TYPE = {
  SUMMARY: "summary",
  SYNTHESIS: "synthesis",
  CONCEPT: "concept",
  ENTITY: "entity",
  DRAFT: "draft",
  ARCHIVE: "archive"
};
var PUBLISHED_WIKI_PAGE_TYPES = /* @__PURE__ */ new Set([
  WIKI_PAGE_TYPE.SUMMARY,
  WIKI_PAGE_TYPE.SYNTHESIS,
  WIKI_PAGE_TYPE.CONCEPT,
  WIKI_PAGE_TYPE.ENTITY
]);
var CONCEPT_ONLY_WIKI_PAGE_TYPES = /* @__PURE__ */ new Set([
  WIKI_PAGE_TYPE.SYNTHESIS,
  WIKI_PAGE_TYPE.CONCEPT
]);
var CONCEPT_WIKI_PAGE_TYPES = /* @__PURE__ */ new Set([
  WIKI_PAGE_TYPE.SYNTHESIS,
  WIKI_PAGE_TYPE.CONCEPT,
  WIKI_PAGE_TYPE.ENTITY
]);
var DRAFT_PENDING_KIND = {
  DRIFT: "drift",
  PARSE: "parse",
  COLLISION: "collision",
  LOW_FAITHFULNESS: "low_faithfulness",
  BAD_TITLE: "bad_title"
};
var TASK_STATUS = {
  QUEUED: "queued",
  ACTIVE: "active",
  DONE: "done",
  FAILED: "failed",
  CANCELLED: "cancelled",
  WAITING: "waiting"
};
var DOT_STATE = {
  PRIMARY: "primary",
  SUCCESS: "success",
  ERROR: "error",
  MUTED: "muted"
};
var TASK_TYPE = {
  SYNC: "sync",
  ADD: "add",
  PULL: "pull",
  CRAWL: "crawl",
  DOWNLOAD: "download",
  WIKI: "wiki",
  DELETE: "delete",
  SETUP: "setup",
  IMPORT: "import"
};
var MODEL_TASK = {
  CHAT: "chat",
  VISION: "vision",
  EMBEDDING: "embedding",
  RERANK: "rerank"
};
var WORKER_ROLE = {
  CHAT: "chat",
  EMBED: "embed",
  RERANK: "rerank",
  VISION: "vision"
};
var REPLICA_ROLES = /* @__PURE__ */ new Set([WORKER_ROLE.EMBED, WORKER_ROLE.VISION]);
var PLACEMENT_MODE = {
  AUTO: "auto",
  MANUAL: "manual"
};
var ERROR_NAME = {
  ABORT_ERROR: "AbortError",
  SESSION_TOKEN: "SessionTokenError",
  SERVER_STARTING: "ServerStartingError",
  RATE_LIMITED: "RateLimitedError"
};
var WIZARD_STEP = {
  WELCOME: 0,
  SERVER_MODE: 1,
  MODEL_PICKER: 2,
  EMBEDDING_PICKER: 3,
  SYNC: 4,
  WIKI: 5,
  DONE: 6
};
var TASK_QUEUE = {
  MAX_CONCURRENT_BACKGROUND: 2,
  MAX_QUEUED_PER_TYPE: 5
};
var BACKGROUND_TASK_TYPES = /* @__PURE__ */ new Set([
  TASK_TYPE.SYNC,
  TASK_TYPE.ADD,
  TASK_TYPE.PULL,
  TASK_TYPE.CRAWL,
  TASK_TYPE.DOWNLOAD,
  TASK_TYPE.WIKI,
  TASK_TYPE.DELETE,
  TASK_TYPE.IMPORT
]);
var PLATFORM = {
  DARWIN: "darwin",
  LINUX: "linux",
  WIN32: "win32"
};
var ARCH = {
  ARM64: "arm64",
  X64: "x64"
};
var SERVER_VARIANT = {
  DEFAULT: "default",
  CU121: "cu121",
  CU124: "cu124",
  CU125: "cu125",
  ROCM: "rocm"
};
var LILBEE_REPO_URL = "https://github.com/tobocop2/lilbee";
var INDETERMINATE_PROGRESS = -1;
var CATALOG_VIEW_MODE = {
  GRID: "grid",
  LIST: "list"
};

// src/locales/en.ts
var ROLE_NOUN = {
  chat: "chat",
  embed: "embedding",
  vision: "vision",
  rerank: "reranking"
};
var roleNoun = (role) => ROLE_NOUN[role];
var indefinite = (word) => /^[aeiou]/i.test(word) ? "an" : "a";
var MESSAGES = {
  CONFIRM_REINDEX: (name) => `"${name}" is already indexed. Re-add it?`,
  LABEL_VAULT_ROOT: "Vault root",
  CONFIRM_SYNC_REBUILD: "Rebuilding the index drops every stored document and re-embeds your whole vault from scratch. This can take a while. Continue?",
  GATEKEEPER_TITLE: "macOS blocked the lilbee server",
  GATEKEEPER_INTRO: "The lilbee server is an open-source binary that isn't code-signed, so macOS Gatekeeper quarantined it. The plugin tried to clear the quarantine flag automatically but couldn't. You can allow it in a few steps:",
  GATEKEEPER_STEP_1: "Open System Settings \u2192 Privacy & Security.",
  GATEKEEPER_STEP_2: `Scroll to the Security section. You'll see a message that "lilbee" was blocked. Click "Allow Anyway".`,
  GATEKEEPER_STEP_3: "Reopen this vault (or run the lilbee command again). On the next launch, click Open when macOS asks.",
  GATEKEEPER_RETRY: "This is a one-time step. Once allowed, the server starts normally from then on.",
  GATEKEEPER_SOURCE: "lilbee is open source. You can review the server's code or build it yourself:",
  LINK_LILBEE_REPO: "github.com/tobocop2/lilbee",
  BUTTON_GOT_IT: "Got it",
  BUTTON_SKIP_SETUP: "Skip setup",
  BUTTON_GET_STARTED: "Get started",
  BUTTON_BACK: "Back",
  BUTTON_NEXT: "Next",
  BUTTON_CONTINUE: "Continue",
  BUTTON_CANCEL: "Cancel",
  BUTTON_PULL: "Pull",
  BUTTON_PULL_MODEL: "Pull Model",
  BUTTON_PULL_ANYWAY: "Pull anyway",
  WARNING_MODEL_EXCEEDS_RAM: (needed, have) => `This model needs ${needed} GB of RAM but your system has only ${have} GB. Loading it will likely fail.`,
  BUTTON_USE: "Use",
  BUTTON_REMOVE: "Delete",
  BUTTON_REFRESH: "Refresh",
  BUTTON_BROWSE_CATALOG: "Browse Catalog",
  BUTTON_BROWSE_FULL_CATALOG: "Browse full catalog",
  BUTTON_BROWSE_MORE: "Browse more\u2026",
  BUTTON_DOWNLOAD_CONTINUE: "Download & continue",
  BUTTON_DELETE_SELECTED: "Delete selected",
  BUTTON_CRAWL: "Crawl",
  BUTTON_START: "Start",
  BUTTON_STOP: "Stop",
  BUTTON_RESTART: "Restart",
  BUTTON_TEST: "Test",
  BUTTON_RESET_MANAGED: "Reset to managed",
  BUTTON_RUN_SETUP_WIZARD: "Run setup wizard",
  BUTTON_INSTALL_SERVER: "Install server",
  BUTTON_REINSTALL: "Reinstall",
  BUTTON_RETRY: "Retry",
  BUTTON_UNINSTALL_SERVER: "Uninstall server",
  BUTTON_UNINSTALL: "Uninstall",
  BUTTON_DOWNLOADING: "Downloading...",
  BUTTON_CANCEL_DOWNLOAD: "Cancel download",
  BUTTON_INSTALL_TAG: (tag) => `Install ${tag}`,
  BUTTON_UPDATE_TO: (tag) => `Update to ${tag}`,
  BUTTON_DOWNGRADE_TO: (tag) => `Downgrade to ${tag}`,
  BUTTON_CLEAR_CHAT: "Clear chat",
  BUTTON_CLEAR_TASKS: "Clear",
  BUTTON_SEND: "Send",
  BUTTON_OPEN_CHAT: "Open chat",
  LABEL_NOT_SET: "Not set",
  LABEL_NO_MODEL_SELECTED: "no model selected",
  LABEL_UNKNOWN: "unknown version",
  LABEL_ALL_TASKS: "All tasks",
  LABEL_ALL_SIZES: "All sizes",
  LABEL_FEATURED: "Featured",
  LABEL_DOWNLOADS: "Downloads",
  LABEL_NAME: "Name",
  LABEL_SIZE_ASC: "Size (asc)",
  LABEL_SIZE_DESC: "Size (desc)",
  LABEL_ACTIVE: "Active",
  LABEL_INSTALLED: "Installed (shared)",
  LABEL_NOT_INSTALLED: " (not installed)",
  LABEL_MODEL: "Model",
  LABEL_SIZE: "Size",
  LABEL_MIN_RAM: "Minimum RAM:",
  LABEL_DESCRIPTION: "Description",
  LABEL_CHAT_MODEL: "Chat Model",
  LABEL_REASONING: "Reasoning",
  LABEL_SOURCES: "Sources",
  LABEL_DEPTH: "Depth cap",
  LABEL_MAX_PAGES: "Max pages",
  LABEL_CRAWL_ADVANCED: "Advanced",
  LABEL_CRAWL_RECURSIVE: "Crawl whole site",
  LABEL_CRAWL_RECURSIVE_INFO: "About whole-site crawl",
  NOTICE_CRAWL_RECURSIVE: "Whole-site crawl follows every internal link it finds on the same origin. Large sites can fetch hundreds of pages and take a while. Use Advanced to cap depth or page count. Request delay, concurrency and retry behavior live in Settings \u2192 Crawling.",
  LABEL_CRAWL_USE_BROWSER: "Use browser (enables JavaScript, uses more memory)",
  LABEL_CRAWL_SUBDOMAINS: "Include subdomains",
  TOOLTIP_CRAWL_URL: "Web page to crawl. A scheme is added for you if you leave it off.",
  TOOLTIP_CRAWL_RECURSIVE: "Follow internal links on the same site instead of crawling just this page.",
  TOOLTIP_CRAWL_SUBDOMAINS: "Also follow links to subdomains of the starting site (for example docs.example.com from example.com).",
  TOOLTIP_CRAWL_USE_BROWSER: "Render pages in Chromium so content built with JavaScript is captured. Use it for sites that render client-side.",
  TOOLTIP_CRAWL_DEPTH: "How many links deep to follow from the starting page. Blank means no limit.",
  TOOLTIP_CRAWL_MAX_PAGES: "Stop after fetching this many pages. Blank means no limit.",
  HINT_CRAWL_BLANK_NO_LIMIT: "blank = no limit",
  ERROR_CRAWL_MAX_PAGES_POSITIVE: "Max pages must be a positive integer or blank",
  ERROR_CRAWL_DEPTH_INVALID: "Depth cap must be a non-negative integer or blank",
  LABEL_SERVER_MODE: "Server mode",
  LABEL_SERVER_STATUS: "Server status",
  LABEL_SERVER_CONTROLS: "Server controls",
  LABEL_SERVER_VERSION: "Server version",
  LABEL_INCLUDE_DEV_BUILDS: "Include dev builds",
  LABEL_SERVER_AUTO_UPDATE: "Automatically update the server",
  LABEL_UNINSTALL: "Uninstall",
  LABEL_UNINSTALL_SERVER: "Uninstall server",
  LABEL_INSTALL_SERVER: "Install server",
  LABEL_SERVER_URL: "Server URL",
  LABEL_SETUP_WIZARD: "Setup wizard",
  LABEL_SWITCH_MANAGED: "Switch to managed server",
  LABEL_MODELS: "Models",
  LABEL_REFRESH_MODELS: "Refresh models",
  LABEL_CHAT_SECTION: "Chat",
  LABEL_SEARCH_RETRIEVAL: "Search & Retrieval",
  LABEL_RESULTS_COUNT: "Results count",
  LABEL_MAX_DISTANCE: "Search strictness",
  LABEL_ADAPTIVE_THRESHOLD: "Adaptive threshold",
  LABEL_GENERATION: "Advanced settings",
  LABEL_RAG_SYSTEM_PROMPT: "RAG system prompt (when answering with documents)",
  LABEL_GENERAL_SYSTEM_PROMPT: "Chat system prompt (when answering without documents)",
  LABEL_CHAT_MODE: "Chat mode",
  LABEL_CHAT_MODE_SEARCH: "Search",
  LABEL_CHAT_MODE_CHAT: "Chat",
  TAB_LOCAL: "Local",
  TAB_FRONTIER: "Hosted",
  TAB_DISCOVER: "Discover",
  TAB_CHAT_MODELS: "Chat",
  TAB_EMBED_MODELS: "Embed",
  TAB_VISION_MODELS: "Vision",
  TAB_RERANK_MODELS: "Rerank",
  TAB_LIBRARY: "Library",
  RAIL_FOR_YOU: "For you",
  RAIL_YOUR_COLLECTION: "Your collection",
  RAIL_FRESH: "Fresh",
  RAIL_NO_ITEMS: "Nothing here yet.",
  RAIL_FOR_YOU_HELP: "Featured models picked for your active chat task.",
  RAIL_YOUR_COLLECTION_HELP: "Models you've already pulled, across every task.",
  RAIL_FRESH_HELP: "The most-downloaded models in the catalog right now.",
  PILL_KEY_READY: "Ready",
  PILL_KEY_NEEDS_KEY: "Needs key",
  MODEL_PICKER_TITLE_CHAT: "Pick chat model",
  MODEL_PICKER_TITLE_EMBED: "Pick embedding model",
  MODEL_PICKER_SEARCH_PLACEHOLDER: "Search models\u2026",
  MODEL_PICKER_LOCAL_HEADING: "Local",
  MODEL_PICKER_EMPTY: "No models match.",
  COMMAND_MODEL_PICKER_CHAT: "Pick chat model",
  COMMAND_MODEL_PICKER_EMBED: "Pick embedding model",
  DESC_CHAT_MODE: "Search uses your documents and returns citations. Chat is a general assistant with no retrieval.",
  TOOLTIP_CHAT_MODE_NEEDS_EMBEDDING: "Configure an embedding model to enable Search.",
  TOOLTIP_MODE_SEARCH: "Search your vault \u2014 finds relevant passages and answers with citations.",
  TOOLTIP_MODE_CHAT: "Chat with the model directly \u2014 no vault retrieval.",
  TOOLTIP_ROLE_CHAT: "Chat model \u2014 writes the answers.",
  TOOLTIP_ROLE_EMBED: "Embedding model \u2014 indexes your notes so search can find them.",
  TOOLTIP_ROLE_VISION: "Vision model \u2014 reads scanned or image-only PDFs. Optional.",
  TOOLTIP_ROLE_RERANK: "Reranker \u2014 reorders search hits for sharper relevance. Optional.",
  LABEL_GEN_TEMPERATURE: "Creativity",
  LABEL_GEN_TOP_P: "Top P",
  LABEL_GEN_TOP_K: "Top K (sampling)",
  LABEL_GEN_REPEAT_PENALTY: "Repetition penalty",
  LABEL_GEN_SEED: "Seed",
  LABEL_GEN_MAX_TOKENS: "Max tokens",
  LABEL_SHOW_REASONING: "Show thinking",
  LABEL_CHAT_COMPACTION: "Condense long conversations",
  LABEL_GEN_MAX_REASONING_CHARS: "Max reasoning characters",
  LABEL_GEN_MODEL_KEEP_ALIVE: "Model keep-alive (s)",
  LABEL_GEN_GPU_MEMORY_FRACTION: "GPU memory fraction",
  LABEL_WORKER_POOL: "Worker pool",
  LABEL_WORKER_POOL_HELP: "Tuning knobs for the background worker processes that run embedding, vision and rerank models.",
  LABEL_WORKER_POOL_CALL_TIMEOUT: "Pool call timeout (s)",
  LABEL_WORKER_POOL_EAGER_START: "Eager start workers",
  LABEL_WORKER_POOL_MAX_IDLE: "Worker idle timeout (s)",
  LABEL_INGEST: "Ingest",
  LABEL_INGEST_HELP: "How documents are split, OCR'd and prepared before they enter the index.",
  LABEL_CHUNK_SIZE: "Chunk size (tokens)",
  LABEL_CHUNK_OVERLAP: "Chunk overlap (tokens)",
  LABEL_TESSERACT_TIMEOUT: "Tesseract per-page timeout (s)",
  LABEL_VISION_LOAD_BUDGET: "Vision OCR pool budget (s)",
  LABEL_RETRIEVAL_ADVANCED: "Retrieval (advanced)",
  LABEL_RETRIEVAL_ADVANCED_HELP: "Lower-level retrieval knobs that shape candidate pools and answer-source diversity.",
  LABEL_CANDIDATE_MULTIPLIER: "Candidate multiplier",
  LABEL_MIN_RELEVANCE_SCORE: "Minimum relevance score",
  LABEL_MAX_CONTEXT_SOURCES: "Max context sources",
  LABEL_DIVERSITY_MAX_PER_SOURCE: "Max chunks per source",
  LABEL_MMR_LAMBDA: "MMR lambda",
  LABEL_CRAWLING: "Crawling",
  LABEL_CRAWL_MAX_DEPTH: "Crawl depth",
  LABEL_CRAWL_MAX_PAGES: "Page limit",
  LABEL_CRAWL_TIMEOUT: "Page timeout",
  LABEL_CRAWL_MEAN_DELAY: "Request delay (seconds)",
  LABEL_CRAWL_MAX_DELAY_RANGE: "Delay jitter (seconds)",
  LABEL_CRAWL_CONCURRENT_REQUESTS: "Concurrent requests",
  LABEL_CRAWL_RETRY_ON_RATE_LIMIT: "Retry on rate-limit",
  LABEL_CRAWL_RETRY_BASE_DELAY_MIN: "Retry base delay min (seconds)",
  LABEL_CRAWL_RETRY_BASE_DELAY_MAX: "Retry base delay max (seconds)",
  LABEL_CRAWL_RETRY_MAX_BACKOFF: "Retry max backoff (seconds)",
  LABEL_CRAWL_RETRY_MAX_ATTEMPTS: "Retry attempts",
  LABEL_CRAWL_RENDER_MODE: "Render mode",
  DESC_CRAWL_RENDER_MODE: "How pages are fetched. Lightweight is a fast HTTP fetch with no JavaScript. Browser runs Chromium so JavaScript-rendered pages work, at the cost of more memory and slower crawls.",
  LABEL_CRAWL_RENDER_MODE_HTTP: "Lightweight (HTTP, no JavaScript)",
  LABEL_CRAWL_RENDER_MODE_BROWSER: "Browser (Chromium, JavaScript)",
  LABEL_CRAWL_EXCLUDE_PATTERNS: "URL exclude patterns",
  DESC_CRAWL_EXCLUDE_PATTERNS: "Regex patterns that skip URLs at link-discovery during recursive crawls. One per line. Blank = no filtering.",
  LABEL_RESET_TO_DEFAULT: "Reset to default",
  LABEL_RESET_ALL_SETTINGS: "Reset server-backed settings to defaults",
  DESC_RESET_ALL_SETTINGS: "Restore every server-backed setting below to its default. API keys and local plugin preferences are preserved.",
  CONFIRM_RESET_ALL_SETTINGS: "Reset every server-backed setting to its default? API keys and local plugin preferences are preserved.",
  BUTTON_RESET_ALL: "Reset all",
  LABEL_ADVANCED: "Advanced",
  LABEL_STORE_CONTENT_IN_VAULT: "Store lilbee content in vault",
  DESC_STORE_CONTENT_IN_VAULT: "Materialize crawled pages and imported files inside your vault so you can browse them in Obsidian. Disabled for external servers \u2014 their files live on the server machine, not your computer.",
  NOTICE_STORAGE_REORGANIZING: "Reorganizing lilbee storage into your vault\u2026",
  NOTICE_STORAGE_REORGANIZED: "Lilbee storage is now inside your vault.",
  NOTICE_STORAGE_REORGANIZE_FAILED: "Could not move lilbee storage into your vault: ",
  NOTICE_TAKE_OVER_SUCCESS: (vaultName) => `lilbee switched from "${vaultName}" to this vault.`,
  NOTICE_TAKE_OVER_DECLINED: (vaultName) => `lilbee stays with "${vaultName}". This vault will run without managed lilbee until you take over or close the other vault.`,
  NOTICE_TAKE_OVER_TIMEOUT: "The other lilbee process did not shut down in time. Try again, or close the other Obsidian window first.",
  CONFIRM_TAKE_OVER: (vaultName) => `lilbee is currently serving "${vaultName}". Switch it to this vault? The other vault will lose its lilbee connection until you reopen it.`,
  STATUS_LOCKED_BY_OTHER: (vaultName) => `lilbee: serving "${vaultName}"`,
  COMMAND_TAKE_OVER: "Take over the managed lilbee server",
  TOOLTIP_MODEL_INSTALLED_SHARED: "Installed in the shared lilbee models directory \u2014 every vault on this computer can use it without re-downloading.",
  LABEL_SHARED_ROOT: "Shared lilbee directory",
  DESC_SHARED_ROOT: (resolved) => `Holds the lilbee binary, model cache, and one subfolder per vault. Leave blank to use the platform default (currently ${resolved}). Restart the plugin or Obsidian for changes to take effect.`,
  LABEL_ADOPT_DATA_DIR: "Use existing lilbee data directory",
  DESC_ADOPT_DATA_DIR: "Point this vault at a lilbee data directory you already have on disk (e.g. one moved from the old per-vault location, or one created by `lilbee serve`). The plugin restarts the managed server against the new path.",
  PLACEHOLDER_ADOPT_DATA_DIR: "/path/to/lilbee/data-dir",
  BUTTON_ADOPT_DATA_DIR: "Use this folder",
  NOTICE_ADOPT_DATA_DIR_BLANK: "Enter a path first.",
  NOTICE_ADOPT_DATA_DIR_DONE: (path) => `lilbee now uses ${path} for this vault.`,
  LABEL_STORAGE_REPORT: "Disk usage",
  DESC_STORAGE_REPORT: "How much disk space the shared binary, model cache, and this vault's data are using right now.",
  LABEL_STORAGE_BIN: "Binary",
  LABEL_STORAGE_MODELS: "Models cache",
  LABEL_STORAGE_VAULT: "This vault",
  LABEL_STORAGE_TOTAL: "Total",
  LABEL_EMBEDDING_MODEL: "Embedding model",
  LABEL_RERANKER_TITLE: "Reranker model",
  LABEL_RERANKER_DISABLED: "(disabled)",
  LABEL_RERANKER_HOSTED_GROUP: "Hosted via LiteLLM",
  LABEL_RERANKER_CANDIDATES: "Rerank candidates",
  DESC_RERANKER_MODEL: "Reorders search results for better relevance. Disabled by default.",
  DESC_RERANKER_CANDIDATES: "How many candidate results to rerank (1-100). Higher = slower but more accurate.",
  NOTICE_FAILED_RERANKER: "lilbee: failed to update reranker model",
  NOTICE_RERANKER_UPDATED: "lilbee: reranker model updated",
  NOTICE_RERANKER_LOAD_FAILED: "lilbee: failed to load reranker options",
  LABEL_VISION_TITLE: "Vision model",
  LABEL_VISION_DISABLED: "(disabled)",
  LABEL_VISION_HOSTED_GROUP: "Hosted via LiteLLM",
  DESC_VISION_MODEL: "Used to read scanned PDFs when OCR fails. Separate from the chat model \u2014 vision models run only on image-only documents.",
  NOTICE_VISION_UPDATED: "lilbee: vision model updated",
  NOTICE_FAILED_VISION: "lilbee: failed to update vision model",
  NOTICE_VISION_LOAD_FAILED: "lilbee: failed to load vision options",
  PLACEHOLDER_RERANK_CANDIDATES: "20",
  LABEL_LLM_PROVIDER: "AI backend",
  LABEL_OPENAI_API_KEY: "OpenAI API key",
  DESC_OPENAI_API_KEY: "For GPT models via litellm",
  LABEL_ANTHROPIC_API_KEY: "Anthropic API key",
  DESC_ANTHROPIC_API_KEY: "For Claude models via litellm",
  LABEL_GEMINI_API_KEY: "Gemini API key",
  DESC_GEMINI_API_KEY: "For Gemini models via litellm",
  LABEL_HF_TOKEN: "HuggingFace token",
  LABEL_OLLAMA_BASE_URL: "Ollama URL",
  LABEL_LM_STUDIO_BASE_URL: "LM Studio URL",
  LABEL_DELETE_MODEL: "Delete model",
  LABEL_GENERATION_HELP: "Fine-tune AI responses. Defaults work well for most users.",
  LABEL_ADVANCED_HELP: "These settings affect how your documents are processed. Only change if you know what you're doing.",
  LABEL_CLOSE_GLYPH: "\xD7",
  LABEL_TASK_CENTER: "Task Center",
  LABEL_TASK_CAP_PILL: "{active}/{cap} running",
  LABEL_TASK_COUNTERS: "{active} running \xB7 {queued} queued \xB7 {done} done",
  LABEL_ACTIVE_TASKS: "ACTIVE",
  LABEL_QUEUED_TASKS: "QUEUED",
  LABEL_COMPLETED_TASKS: "COMPLETED",
  LABEL_NO_ACTIVE_TASKS: "No active tasks",
  LABEL_NO_QUEUED_TASKS: "No queued tasks",
  LABEL_NO_COMPLETED_TASKS: "No completed tasks",
  LABEL_CANCEL_TASK: "Cancel task",
  LABEL_RETRY_TASK: "Retry",
  LABEL_TASK_STATE_QUEUED: "queued",
  LABEL_TASK_STATE_DONE: "done",
  LABEL_TASK_STATE_FAILED: "failed",
  LABEL_TASK_STATE_CANCELLED: "cancelled",
  LABEL_TASK_STATE_WAITING: "waiting on server",
  STATUS_WAITING_ON_SERVER: "Already ingesting on the server \u2014 waiting for it to finish",
  STATUS_TASKS_RUNNING_PLURAL: "{count} tasks running \xB7 {name} {pct}%",
  STATUS_TASK_RUNNING_SINGLE: "{name} {pct}%",
  // A job whose length cannot be known reads as stuck when it is labelled 0%,
  // so those drop the number rather than reporting a false one.
  STATUS_TASK_RUNNING_SINGLE_INDETERMINATE: "{name}",
  STATUS_TASKS_RUNNING_PLURAL_INDETERMINATE: "{count} tasks running \xB7 {name}",
  STATUS_TASKS_QUEUED_ONLY: "{count} queued",
  STATUS_TASK_DONE_FLASH: "Done \xB7 {name}",
  STATUS_TASKS_DONE_FLASH: "{count} tasks done \xB7 {name}",
  STATUS_TASK_FAILED_FLASH: "{count} task failed \xB7 {name}",
  STATUS_TASKS_FAILED_FLASH: "{count} tasks failed \xB7 {name}",
  LABEL_ADD_FILE: "Add file",
  LABEL_SAVE_VAULT: "Save to vault",
  LABEL_OPEN_GPU_ACTIVITY: "GPU activity beside chat",
  LABEL_STOPPED: "(stopped)",
  LABEL_STOPPED_MD: "*(stopped)*",
  LABEL_CONNECTING: "(connecting...)",
  LABEL_OFFLINE: "(offline)",
  LABEL_CHAT_VIEW: "lilbee Chat",
  LABEL_TASKS_VIEW: "lilbee Tasks",
  LABEL_RIBBON_OPEN_CHAT: "Open lilbee chat",
  LABEL_STATUSBAR_OPEN_SETTINGS: "Open lilbee settings",
  ERROR_STREAM_IDLE: "server stopped sending events \u2014 check that lilbee is running",
  LABEL_OUR_PICKS: "Our picks",
  LABEL_SECTION_INSTALLED: "Installed",
  LABEL_SECTION_CHAT: "Chat",
  LABEL_SECTION_EMBEDDING: "Embedding",
  LABEL_SECTION_VISION: "Vision",
  LABEL_SECTION_RERANK: "Rerank",
  LABEL_PICK: "pick",
  LABEL_FIT_FITS: "fits",
  LABEL_FIT_TIGHT: "tight",
  LABEL_FIT_WONT_RUN: "won't run",
  LABEL_COMPAT_UNSUPPORTED: "Unsupported",
  TOOLTIP_COMPAT_UNSUPPORTED: (architecture) => architecture ? `Your lilbee server doesn't support this model's architecture (${architecture}).` : "Your lilbee server doesn't support this model's architecture.",
  TOOLTIP_PULL_UNSUPPORTED: "This model isn't supported by your lilbee server.",
  LABEL_SWITCH_TO_LIST: "Switch to list view",
  LABEL_SWITCH_TO_GRID: "Switch to grid view",
  LABEL_VIEW_TOGGLE_CTA: "Switch to list view for the full catalog",
  LABEL_NO_MODELS_FOUND: "No models match your filters.",
  LABEL_DETAIL_VARIANTS: "Size variants",
  LABEL_DETAIL_DESCRIPTION: "Description",
  LABEL_DETAIL_DOWNLOADS: "Downloads",
  LABEL_DETAIL_INSTALL_STATUS: "Status",
  BUTTON_DRAWER_TOGGLE: "Toggle details",
  LABEL_DRAWER_NO_SELECTION: "Focus a model to see its details.",
  MODEL_INFO_TITLE: "Model info",
  LABEL_MODEL_INFO_BTN: "Show details",
  MODEL_INFO_TASK: "Task",
  MODEL_INFO_PARAMS: "Parameters",
  MODEL_INFO_CONTEXT: "Context window",
  MODEL_INFO_QUANT: "Quantization",
  MODEL_INFO_RAM: "Recommended RAM",
  MODEL_INFO_DOWNLOADS: "Downloads",
  MODEL_INFO_HF_LINK_LABEL: "View on Hugging Face",
  COMMAND_MODEL_INFO_CHAT: "Show info for active chat model",
  COMMAND_MODEL_INFO_EMBED: "Show info for active embedding model",
  NOTICE_NO_ACTIVE_MODEL: (task) => `No active ${task} model is set.`,
  LABEL_TASK: "Task",
  LABEL_DOWNLOADS_COUNT: (count) => `${count} downloads`,
  LABEL_SIZE_SMALL: "Small",
  LABEL_SIZE_MEDIUM: "Medium",
  LABEL_SIZE_LARGE: "Large",
  DESC_SERVER_MODE: "How the lilbee server is managed",
  DESC_MANAGED_BUILTIN: "Managed (built-in)",
  DESC_EXTERNAL_MANUAL: "External (manual)",
  DESC_SETUP_WIZARD: "Walk through initial setup again",
  DESC_SERVER_STATUS_CURRENT: "Current state of the managed lilbee server",
  DESC_SERVER_CONTROLS_START_STOP: "Start, stop, or restart the managed server",
  DESC_SERVER_VERSION_UNKNOWN: "Unknown",
  DESC_SERVER_VERSION_INSTALLED: (tag) => `${tag} installed. This is the latest release.`,
  DESC_SERVER_VERSION_OUTDATED: (tag) => `${tag} installed. Newer releases are available.`,
  DESC_SERVER_VERSION_PLAIN: (tag) => `${tag} installed.`,
  DESC_SERVER_VERSION_UPDATE: (installed, tag) => `${installed} installed. ${tag} is available.`,
  DESC_SERVER_VERSION_DOWNGRADE: (installed) => `${installed} installed. Downgrading replaces it with an older build and turns off automatic server updates.`,
  DESC_SERVER_VERSION_LOADING: "Reading the release list from GitHub...",
  /** How a server build is named wherever the user sees one. macOS ships Metal in the
   *  default build and Linux and Windows ship Vulkan, so the default is named for neither. */
  LABEL_SERVER_BUILD: (variant) => {
    if (variant === SERVER_VARIANT.ROCM) return "ROCm";
    if (variant === SERVER_VARIANT.DEFAULT) return "default";
    return `CUDA ${variant.slice(2, 4)}.${variant.slice(4)}`;
  },
  DESC_SERVER_BUILD: (build) => ` Running the ${build} build.`,
  DESC_SERVER_VERSION_OFFLINE: (tag, reason) => `${tag} installed. The release list could not be read from GitHub: ${reason}`,
  DESC_DEV_BUILD_AVAILABLE: (tag) => `A newer dev build (${tag}) is out. Turn on "Include dev builds" to try it.`,
  DESC_SERVER_AUTO_UPDATE: "Install the latest server release when the plugin updates. Turned off automatically when you install an older version, so an explicit downgrade sticks.",
  DESC_INCLUDE_DEV_BUILDS: "Offer in-development builds in the version list and track them for updates. They ship the newest features but get less testing than a stable release.",
  BUG_FEEDBACK_PREFIX: "Found a bug? Report it on ",
  BUG_FEEDBACK_GITHUB: "GitHub issues",
  BUG_FEEDBACK_IRC: "#lilbee on Libera Chat",
  BUG_FEEDBACK_SUFFIX: ". Reports help improve lilbee, and reporters get credited in the release notes.",
  TOOLTIP_SERVER_VERSION_SUPPORT: "This plugin is built and tested against the latest server release. Older releases still install and run, but they are not supported, and features the plugin expects may be missing. Use a non-default release at your own risk.",
  TOOLTIP_UNINSTALL_SECTION: "Obsidian does not manage the lilbee server executable or its models, this plugin does. Removing the plugin from Obsidian's Community plugins pane leaves both on disk. Uninstall here first.",
  CALLOUT_UNINSTALL_FIRST: "Removing the plugin does not remove the server. The executable, the downloaded models, and this vault's index live outside your vault, so Obsidian never touches them. Uninstall here before you remove the plugin and nothing is left behind.",
  DESC_UNINSTALL_SERVER: (size) => `Deletes the executable, the models, and this vault's index. Frees ${size}. Your notes are not touched.`,
  DESC_INSTALL_SERVER: (size) => `Downloads the lilbee server, about ${size}. Models are pulled on demand afterwards.`,
  DESC_SERVER_DOWNLOADING: "The lilbee server is downloading. Progress is in the status bar.",
  DESC_SERVER_NOT_INSTALLED: "The server is not installed. Chat, search, and sync are unavailable until you install it.",
  CONFIRM_UNINSTALL_TITLE: "Uninstall the lilbee server?",
  CONFIRM_UNINSTALL_BODY: "This removes everything lilbee downloaded or built for this vault. It cannot be undone, but you can install the server again at any time.",
  LABEL_UNINSTALL_BINARY: "Server executable",
  LABEL_UNINSTALL_MODELS: "Downloaded models",
  LABEL_UNINSTALL_INDEX: "Search index for this vault",
  LABEL_UNINSTALL_KEEP: "Your notes and attachments",
  LABEL_UNINSTALL_KEEP_VALUE: "untouched",
  LABEL_UNINSTALL_DELETE_TAG: "Delete",
  LABEL_UNINSTALL_KEEP_TAG: "Keep",
  NOTICE_UNINSTALLED: (size) => `lilbee server uninstalled. ${size} freed.`,
  NOTICE_INSTALLED: (tag) => `lilbee server ${tag} installed.`,
  NOTICE_DOWNLOAD_CANCELED: "lilbee server download cancelled.",
  ERROR_UNINSTALL_FAILED: "Could not uninstall the lilbee server",
  ERROR_UNINSTALL_SERVER_IN_USE: (vaultName) => `The lilbee server is running for ${vaultName}. Close that vault, then uninstall.`,
  ERROR_INSTALL_FAILED: "Could not install the lilbee server",
  ERROR_RELEASE_LIST: (reason) => `Could not read the lilbee release list from GitHub: ${reason}`,
  DESC_SERVER_URL_HELP: "Address of the lilbee HTTP server",
  LABEL_MANUAL_TOKEN: "Session token",
  DESC_MANUAL_TOKEN: "Paste the server's session token (required for remote servers). When the lilbee server runs on this machine the plugin discovers the token automatically \u2014 leave this blank.",
  DESC_SWITCH_MANAGED: "Stop using an external server and start the built-in one",
  DESC_MODELS_HELP: "Browse the catalog for available models. Requires the lilbee server.",
  DESC_REFRESH_MODELS: "Fetch available models from the server",
  DESC_RESULTS_COUNT: "How many matching passages to return when you search or ask a question",
  DESC_MAX_DISTANCE: "How closely results must match your query. Lower = only very close matches, higher = broader results",
  DESC_ADAPTIVE_THRESHOLD: "Automatically broaden the search if too few results are found",
  DESC_RAG_SYSTEM_PROMPT: "System prompt sent to the chat model when the answer is grounded in retrieved documents (Search mode with at least one match). Leave blank for the default.",
  DESC_GENERAL_SYSTEM_PROMPT: "System prompt sent to the chat model in Chat mode and when Search returns zero results. Leave blank for the default.",
  DESC_GEN_TEMPERATURE: "Higher = more creative and varied responses, lower = more focused and predictable",
  DESC_GEN_TOP_P: "Controls response diversity. Most users should leave this at the default.",
  DESC_GEN_TOP_K: "Limits which words the AI considers. Most users should leave this at the default.",
  DESC_GEN_REPEAT_PENALTY: "How strongly to avoid repeating the same phrases",
  DESC_GEN_SEED: "Set a number for reproducible responses. Leave blank for varied answers.",
  DESC_GEN_MAX_TOKENS: "Hard cap on generated tokens per response (blank = no cap)",
  DESC_SHOW_REASONING: "Show a reasoning model's thinking in the chat, in a collapsible block above each answer. Off strips it.",
  DESC_CHAT_COMPACTION: "When a conversation outgrows the model's context, fold the oldest messages into a summary instead of dropping them.",
  DESC_GEN_MAX_REASONING_CHARS: "Maximum reasoning characters before lilbee forces the model to answer (per-model overrides apply on top)",
  DESC_GEN_MODEL_KEEP_ALIVE: "Seconds the loaded model stays warm between calls (0 = unload immediately)",
  DESC_GEN_GPU_MEMORY_FRACTION: "Fraction of GPU memory the model is allowed to claim (0.1-1.0)",
  DESC_WORKER_POOL_CALL_TIMEOUT: "Per-call deadline for one worker-pool round-trip in seconds. Raise this for very large embed batches on slow machines",
  DESC_WORKER_POOL_EAGER_START: "Spawn every worker process when the lilbee server starts instead of on first use. Trades 1\u20133 seconds of cold-start per role for first-call latency.",
  DESC_WORKER_POOL_MAX_IDLE: "Shut a worker down after this many seconds idle to free RAM/VRAM. 0 disables idle reaping",
  DESC_TESSERACT_TIMEOUT: "Per-page Tesseract timeout in seconds (used when no vision model is set)",
  DESC_VISION_LOAD_BUDGET: "Outer wall-clock budget for the vision-OCR pool drain in seconds. Includes load grace plus per-page time",
  DESC_CANDIDATE_MULTIPLIER: "Candidate-pool multiplier over top_k before reranking",
  DESC_MIN_RELEVANCE_SCORE: "Minimum RRF relevance score for hybrid search results (0.0 = no filter)",
  DESC_MAX_CONTEXT_SOURCES: "Maximum unique sources contributing chunks to a single answer",
  DESC_DIVERSITY_MAX_PER_SOURCE: "Maximum chunks accepted from any one source (caps source dominance)",
  DESC_MMR_LAMBDA: "MMR lambda balancing relevance vs diversity (0 = max diversity, 1 = max relevance)",
  DESC_CRAWL_MAX_DEPTH: "Optional ceiling on crawl depth. Leave blank for no cap.",
  DESC_CRAWL_MAX_PAGES: "Optional ceiling on pages per crawl. Leave blank for no cap.",
  DESC_CRAWL_TIMEOUT: "How long to wait for each page to load before giving up",
  DESC_CRAWL_MEAN_DELAY: "Average delay between requests within a crawl, in seconds.",
  DESC_CRAWL_MAX_DELAY_RANGE: "Random jitter added to the mean delay, in seconds.",
  DESC_CRAWL_CONCURRENT_REQUESTS: "Maximum concurrent in-flight URLs within a single crawl.",
  DESC_CRAWL_RETRY_ON_RATE_LIMIT: "Retry with backoff when servers return 429 or 503.",
  DESC_CRAWL_RETRY_BASE_DELAY_MIN: "Minimum base backoff delay on rate-limit responses, in seconds.",
  DESC_CRAWL_RETRY_BASE_DELAY_MAX: "Maximum base backoff delay on rate-limit responses, in seconds.",
  DESC_CRAWL_RETRY_MAX_BACKOFF: "Upper bound on any single backoff wait, in seconds.",
  DESC_CRAWL_RETRY_MAX_ATTEMPTS: "Retry count per URL before giving up.",
  DESC_CHUNK_SIZE: "Document chunk size in tokens (changes invalidate the index)",
  DESC_CHUNK_OVERLAP: "Tokens of overlap between adjacent chunks (preserves context across boundaries)",
  DESC_EMBEDDING_MODEL: "The AI model used to understand your documents. Changing requires re-indexing.",
  DESC_LLM_PROVIDER: "Auto picks the best available. Use External to connect to OpenAI, Claude, or other services.",
  DESC_LLM_PROVIDER_AUTO: "Auto (recommended)",
  DESC_LLM_PROVIDER_LOCAL: "Local only (llama-cpp)",
  DESC_LLM_PROVIDER_EXTERNAL: "External (OpenAI, Claude, etc.)",
  DESC_HF_TOKEN: "Needed for some models. Get one free at huggingface.co/settings/tokens",
  DESC_OLLAMA_BASE_URL: "Where your Ollama server is listening. Leave blank for the default (http://localhost:11434).",
  DESC_LM_STUDIO_BASE_URL: "Where your LM Studio server is listening. Leave blank for the default (http://localhost:1234/v1).",
  DESC_REINDEX_WARNING: "Changing {field} will require re-indexing all documents. Continue?",
  DESC_EMBEDDING_REINDEX_WARNING: "Changing the embedding model will require re-indexing all documents. Continue?",
  PLACEHOLDER_DEFAULT: "Default",
  PLACEHOLDER_NOT_SET: "Not set",
  PLACEHOLDER_SEARCH_MODELS: "Search models...",
  PLACEHOLDER_SEARCH_DOCUMENTS: "Search documents...",
  PLACEHOLDER_TYPE_SEARCH: "Type to search...",
  PLACEHOLDER_ASK_SOMETHING: "Ask something...",
  PLACEHOLDER_FILTER_SETTINGS: "Filter settings...",
  PLACEHOLDER_HTTP_LOCALHOST: "http://127.0.0.1:7433",
  PLACEHOLDER_SK: "sk-...",
  PLACEHOLDER_HF_TOKEN: "hf_...",
  PLACEHOLDER_PICK_VAULT_FILE: "Pick a vault file to add to lilbee...",
  PLACEHOLDER_URL: "https://example.com",
  PLACEHOLDER_30: "30",
  LABEL_ENTER_QUERY: "Enter a query to begin.",
  LABEL_NO_RESULTS: "No results found.",
  ERROR_SEARCH_CONNECT: "Error: could not connect to lilbee server.",
  TITLE_SEARCH: "Search knowledge base",
  TITLE_MODEL_CATALOG: "Model Catalog",
  TITLE_DOCUMENTS: "Documents",
  TITLE_SESSIONS: "Sessions",
  LABEL_OPEN_SESSIONS: "Saved conversations",
  LABEL_SESSION_SUMMARY: "Summary of earlier messages",
  LABEL_NEW_SESSION: "New chat",
  LABEL_RENAME_SESSION: "Rename",
  LABEL_DELETE_SESSION: "Delete",
  PLACEHOLDER_FILTER_SESSIONS: "Filter conversations...",
  PLACEHOLDER_RENAME_SESSION: "New name (enter saves, esc cancels)",
  SESSIONS_COUNT: (count) => `${count} saved`,
  SESSIONS_EMPTY: "No saved conversations yet.",
  SESSIONS_NO_MATCH: "No conversations match that filter.",
  SESSIONS_ROW_META: (count, model) => `${count} msgs \xB7 ${model}`,
  SESSIONS_UNTITLED: "Untitled chat",
  CHAT_WARMING: "Loading the chat model\u2026",
  TOOLTIP_COMPACTION: "Condensing keeps the model aware of everything you have discussed, instead of letting the oldest messages fall out of what it can see. Your transcript keeps them either way. Turn it off with \u201CCondense long conversations\u201D in Settings.",
  CHAT_COMPACTING: "Condensing earlier messages\u2026",
  CHAT_COMPACTING_PROGRESS: (batch, total) => `Condensing earlier messages\u2026 (${batch} of ${total})`,
  CHAT_COMPACTED: (count) => `${count} messages condensed into a summary`,
  CHAT_COMPACTED_PARTIAL: (condensed, stranded) => `${condensed} condensed, ${stranded} dropped without notes`,
  CHAT_STRANDED: (count) => `${count} earlier messages dropped without notes`,
  SESSIONS_DISABLED: "Saved conversations are turned off on this server.",
  LABEL_ENABLE_SESSIONS: "Turn on",
  NOTICE_SESSION_RESUMED: (title) => `Resumed \xB7 ${title}`,
  NOTICE_SESSION_NEW: "Started a new chat",
  NOTICE_SESSION_DELETED: (title) => `Deleted \xB7 ${title}`,
  NOTICE_CONFIRM_DELETE_SESSION: (title) => `Delete "${title}"? This cannot be undone.`,
  NOTICE_SESSION_MODEL_UNAVAILABLE: (model, current) => `This conversation used ${model}, which isn't installed. Keeping ${current}.`,
  ERROR_SESSIONS_LOAD_FAILED: (reason) => `Could not load conversations: ${reason}`,
  ERROR_SESSION_RESUME_FAILED: (reason) => `Could not resume conversation: ${reason}`,
  ERROR_SESSION_RENAME_FAILED: (reason) => `Could not rename conversation: ${reason}`,
  ERROR_SESSION_DELETE_FAILED: (reason) => `Could not delete conversation: ${reason}`,
  ERROR_SESSIONS_ENABLE_FAILED: (reason) => `Could not turn on saved conversations: ${reason}`,
  TITLE_CRAWL_WEB_PAGE: "Crawl web page",
  TITLE_DOWNLOAD_MODEL: "Download model?",
  TITLE_WELCOME: "Welcome to lilbee",
  TITLE_SERVER_MODE: "How do you want to run lilbee?",
  TITLE_PICK_MODEL: "Pick a chat model",
  TITLE_INDEX_VAULT: "Index your vault",
  TITLE_ALL_SET: "You're all set!",
  TITLE_MANAGED_RECOMMENDED: "Managed (recommended)",
  TITLE_EXTERNAL: "External",
  STATUS_DOWNLOADING: "lilbee: downloading...",
  STATUS_DOWNLOADING_PERCENT: (percent) => `lilbee: downloading ${percent}%`,
  STATUS_DOWNLOAD_PROGRESS: (percent, received, total) => `Downloading... ${percent}% (${received} of ${total})`,
  STATUS_DOWNLOAD_RECEIVED: (received) => `Downloading... ${received}`,
  STATUS_UPDATE_SIZE: (tag, size) => `Updating to ${tag} \xB7 ${size} download`,
  STATUS_STARTING: "lilbee: starting...",
  STATUS_WARMING: "lilbee: warming up...",
  STATUS_READY: "lilbee: ready",
  STATUS_READY_EXTERNAL: "lilbee: ready [external]",
  STATUS_ERROR: "lilbee: error",
  STATUS_AUTH_ERROR: "lilbee: auth error",
  NOTICE_SERVER_UNREACHABLE: "lilbee: server unreachable",
  STATUS_STOPPED: "lilbee: stopped",
  STATUS_NOT_INSTALLED: "lilbee: server not installed",
  STATUS_ADDING: "lilbee: adding {label}...",
  STATUS_NOTHING_NEW: "lilbee: nothing new to add",
  STATUS_ADD_CANCELLED: "lilbee: add cancelled",
  STATUS_SYNCED: "lilbee: synced \u2014 {summary}",
  STATUS_SYNC_CANCELLED: "lilbee: sync cancelled",
  STATUS_SYNC_FAILED: "lilbee: sync failed",
  STATUS_SYNC_PILL: (n) => `\u27F3 ${n}`,
  TOOLTIP_PENDING_SYNC_HINT: "Click to sync new documents",
  STATUS_STARTING_SERVER: "Starting server...",
  WIZARD_SETUP_HEAD: "Setting up lilbee",
  WIZARD_SETUP_RUNNING: "lilbee server is running",
  WIZARD_SETUP_DOWNLOAD_PENDING: "Download lilbee server",
  WIZARD_SETUP_DOWNLOAD_ACTIVE: "Downloading lilbee server",
  WIZARD_SETUP_DOWNLOAD_DONE: "Downloaded lilbee server",
  WIZARD_SETUP_START_PENDING: "Start the server",
  WIZARD_SETUP_START_ACTIVE: "Starting the server",
  WIZARD_SETUP_START_DONE: "Started the server",
  WIZARD_SETUP_READY_PENDING: "Server ready",
  WIZARD_SETUP_READY_DONE: "Server ready \xB7 listening on 127.0.0.1",
  WIZARD_SETUP_DOWNLOAD_HINT: "Downloading\u2026 up to ~1 min on first run.",
  WIZARD_SETUP_START_HINT: "Booting \xB7 waiting for the server to respond\u2026",
  WIZARD_SETUP_GATE: "You can't continue until the server is ready.",
  WIZARD_SETUP_SOURCE: "Server source:",
  WIZARD_EXTERNAL_TOKEN_HINT: "Paste the session token from your lilbee server (found with `lilbee token`). Required for the plugin to authenticate against a remote server.",
  PLACEHOLDER_MANUAL_TOKEN: "lilbee-\u2026",
  STATUS_CHECKING_CONNECTION: "Checking connection...",
  STATUS_DOWNLOADING_MODEL: "Downloading {model}...",
  STATUS_DOWNLOADING_MODEL_PCT: "Downloading {model}... {pct}%",
  STATUS_PROCESSING_FILES: "Processing {current}/{total} files",
  STATUS_TASK_FILE: "file {current}/{total}",
  STATUS_TASK_SYNCING_FILE: "syncing {current}/{total}",
  STATUS_TASK_EXTRACTING: "extracting {file} p{page}/{total}",
  STATUS_TASK_EMBEDDING: "embedding chunk {chunk}/{total}",
  STATUS_TASK_BATCH: (current, total, file, status) => `${status} ${current}/${total} ${file}`,
  STATUS_TASK_CRAWLER_PREPARING: "Preparing crawler\u2026",
  STATUS_TASK_SETUP_PROGRESS: "chromium: {downloaded}/{total} MB",
  STATUS_TASK_SETUP_PROGRESS_INDETERMINATE: "chromium: {downloaded} MB",
  STATUS_INDEXING: "Indexing: {file}",
  STATUS_DONE: "Done!",
  STATUS_REMOVING: "Removing...",
  STATUS_SETTING: "Setting...",
  ERROR_UNKNOWN: "unknown error",
  ERROR_CANNOT_CONNECT: "cannot connect to server",
  ERROR_COULD_NOT_CONNECT: "lilbee: cannot connect to server",
  ERROR_SERVER_CRASHED: "lilbee: server crashed after multiple restarts",
  ERROR_SERVER_SHUTDOWN_FAILED: "lilbee: failed to stop the managed server",
  ERROR_FAILED_UPDATE: "lilbee: update failed",
  NOTICE_SERVER_AUTO_UPDATING: (version) => `lilbee: updating server to ${version}...`,
  NOTICE_SERVER_AUTO_UPDATED: (version) => `lilbee server updated to ${version}`,
  NOTICE_SERVER_SWITCHING_BUILD: (build) => `lilbee: switching to the ${build} build for your GPU...`,
  NOTICE_SERVER_SWITCHED_BUILD: (build) => `lilbee server now runs the ${build} build`,
  NOTICE_SERVER_AUTO_UPDATE_FAILED: "lilbee: automatic server update failed. You can retry from settings.",
  NOTICE_EXTERNAL_SERVER_OUTDATED: (current, latest) => `Your lilbee server (${current}) is behind the latest release (${latest}). Update it to get the newest features and fixes.`,
  ERROR_LOAD_CATALOG: "lilbee: failed to load catalog",
  ERROR_LOAD_DOCUMENTS: "lilbee: failed to load documents",
  ERROR_DELETE_DOCUMENTS: "lilbee: failed to delete documents",
  ERROR_SWITCH_MODEL: "lilbee: failed to switch model",
  ERROR_PULL_MODEL: "lilbee: failed to pull {model}",
  ERROR_REMOVE_MODEL: "Failed to remove {model}",
  ERROR_SET_MODEL: "Failed to set {model}",
  ERROR_DELETE_MODEL: "Failed to delete {model}",
  ERROR_SAVE_CHAT: "Failed to save chat",
  ERROR_FILE_PICKER: "lilbee: could not open file picker",
  ERROR_LOAD_MODELS: "Could not load models from server.",
  ERROR_START_SERVER: "Failed to start server. Check the settings tab for details.",
  ERROR_COULD_NOT_CONNECT_EXT: "Could not connect. Check the URL and make sure the server is running.",
  ERROR_DOWNLOAD_FAILED: "Download failed. Please try again or pick a different model.",
  ERROR_INDEXING_FAILED: "Indexing failed. You can retry from the settings tab.",
  ERROR_CRAWL_FAILED: "lilbee: crawl failed \u2014 {msg}",
  ERROR_CRAWL_ERROR: "lilbee: crawl error \u2014 {msg}",
  ERROR_CRAWLER_SETUP_FAILED: "Crawler setup failed: {error}. Run 'make crawl-setup' in the lilbee repo or 'lilbee setup crawler' to retry.",
  ERROR_CRAWLER_SETUP_FAILED_SHORT: "Chromium setup failed \u2014 see setup task",
  ERROR_SERVER_UNREACHABLE: "Could not connect to lilbee server. Is it running?",
  ERROR_STREAM: (msg) => `lilbee: ${msg}`,
  ERROR_CHAT_FAILED: (reason) => `Chat failed: ${reason}`,
  ERROR_STREAM_INTERRUPTED_MANAGED: "Chat failed: the server closed the stream unexpectedly. Check the server logs in the logs folder of lilbee's data directory (inside Obsidian's app data folder), then try again.",
  ERROR_STREAM_INTERRUPTED_EXTERNAL: "Chat failed: the server closed the stream unexpectedly. Check the output of your lilbee serve process, then try again.",
  NOTICE_MODEL_UNAVAILABLE_SETUP: "Your model isn't available. Opening setup so you can pick a working one.",
  ERROR_RATE_LIMITED: (retryAfterSeconds) => retryAfterSeconds !== null ? `lilbee is busy with another request. Try again in ${retryAfterSeconds} seconds.` : `lilbee is busy with another request. Try again in a moment.`,
  ERROR_ADD_FAILED_DETAIL: (msg) => `lilbee: add failed \u2014 ${msg}`,
  NOTICE_ALREADY_INGESTING: (source) => `lilbee: server is already ingesting ${source} \u2014 waiting for it to finish`,
  NOTICE_NO_CHAT_MODEL: "lilbee: no chat model set \u2014 select one in settings",
  NOTICE_FLEET_WARMING: "lilbee: the model is still loading \u2014 try again in a moment",
  NOTICE_MODEL_ACTIVATED: (model) => `Now using ${model}`,
  NOTICE_PULL_CANCELLED: "lilbee: pull cancelled",
  NOTICE_NO_TOKEN_MANAGED: "lilbee: managed server didn't produce a session token \u2014 try restarting the plugin",
  NOTICE_NO_TOKEN_EXTERNAL: "lilbee: no session token \u2014 run 'lilbee token' and paste it in Settings \u2192 Session token, or set LILBEE_DATA",
  NOTICE_SESSION_TOKEN_INVALID: "lilbee: session token invalid \u2014 paste a new one in Settings \u2192 Session token",
  NOTICE_SESSION_TOKEN_INVALID_MANAGED: "lilbee: managed server rejected its own token \u2014 restart the server from Settings \u2192 Switch to managed server, or open Status for logs",
  NOTICE_QUEUE_FULL: "lilbee: too many tasks queued \u2014 wait for some to finish",
  LABEL_DATASET_FILTER: "lilbee dataset",
  LABEL_DATASET_IMPORT_TASK: "Importing dataset",
  STATUS_DATASET_IMPORTING: "Re-embedding pages\u2026",
  STATUS_DATASET_EMBEDDING: (file) => `Re-embedding ${file}\u2026`,
  NOTICE_DATASET_EXPORTED: (path) => `lilbee: exported dataset to ${path}`,
  ERROR_DATASET_EXPORT: (msg) => `lilbee: export failed \u2014 ${msg}`,
  ERROR_DATASET_READ: (msg) => `lilbee: could not read dataset \u2014 ${msg}`,
  ERROR_DATASET_TOO_LARGE: "lilbee: dataset exceeds the 10 MB upload limit \u2014 use `lilbee import` from the CLI for larger files",
  NOTICE_DATASET_IMPORTED: (sources, pages, chunks, folder) => `lilbee: imported ${sources} source(s) into "${folder}/" (${pages} page(s), ${chunks} chunk(s))`,
  ERROR_DATASET_IMPORT: (msg) => `lilbee: import failed \u2014 ${msg}`,
  NOTICE_MODEL_ACTIVATED_FULL: (model) => `lilbee: ${model} pulled and activated`,
  NOTICE_SET_MODEL: (type, model) => `${type} set to ${model}`,
  NOTICE_FAILED_SET_MODEL: (type) => `Failed to set ${type} model`,
  NOTICE_UPDATED: (field) => `lilbee: ${field} updated`,
  NOTICE_FAILED_UPDATE: (field) => `lilbee: failed to update ${field}`,
  NOTICE_FIELD_UPDATED: (field) => `lilbee: ${field} updated`,
  NOTICE_FIELD_RESET: (field) => `lilbee: ${field} reset to default`,
  NOTICE_FAILED_RESET: (field) => `lilbee: failed to reset ${field}`,
  NOTICE_SETTINGS_RESET: "lilbee: settings reset to defaults",
  NOTICE_FAILED_RESET_ALL: "lilbee: failed to reset settings",
  NOTICE_REINDEX_REQUIRED: "lilbee: re-indexing required \u2014 starting sync...",
  NOTICE_API_KEY_SAVED: "lilbee: API key saved",
  NOTICE_HF_TOKEN_SAVED: "lilbee: HuggingFace token saved",
  NOTICE_FAILED_HF_TOKEN: "lilbee: failed to save HuggingFace token",
  NOTICE_FAILED_SAVE_KEY: "lilbee: failed to save API key",
  NOTICE_LLM_UPDATED: "lilbee: LLM provider updated",
  NOTICE_FAILED_LLM: "lilbee: failed to update LLM provider",
  NOTICE_LOCAL_SERVER_URL_UPDATED: "lilbee: local server URL updated",
  NOTICE_FAILED_LOCAL_SERVER_URL: "lilbee: failed to update local server URL",
  NOTICE_EMBEDDING_UPDATED: "lilbee: embedding model updated",
  NOTICE_FAILED_EMBEDDING: "lilbee: failed to update embedding model",
  NOTICE_UPDATED_TO: (version) => `lilbee: updated to ${version}`,
  NOTICE_DELETED: (count) => `lilbee: deleted ${count} documents`,
  NOTICE_SAVED: (path) => `Saved to ${path}`,
  NOTICE_REMOVED: (model) => `Deleted ${model}`,
  NOTICE_SYNC_SUMMARY: (summary) => `lilbee: ${summary}`,
  NOTICE_CRAWL_DONE: (pages) => `lilbee: crawl done \u2014 ${pages} pages`,
  NOTICE_ENTER_URL: "lilbee: please enter a URL",
  NOTICE_DOWNLOAD_CANCELLED: "lilbee: download cancelled",
  NOTICE_INDEXING_CANCELLED: "lilbee: indexing cancelled",
  NOTICE_NOTHING_SAVE: "Nothing to save",
  NOTICE_NO_MODELS_INSTALLED: "No models installed.",
  NOTICE_NO_MODELS_DESCRIPTION: "Download a model to start chatting with your notes",
  NOTICE_CONFIRM_CANCEL: "This operation is already in progress on the server. Canceling will hide it from the task center, but it may still complete. Continue?",
  NOTICE_CONFIRM_REMOVE: (model) => `Remove ${model}? This deletes the model file from disk.`,
  NOTICE_CONFIRM_DELETE_DOCS: (count) => `Delete ${count} document(s) from index and disk? This cannot be undone.`,
  COMMAND_SEARCH: "Search knowledge base",
  COMMAND_CHAT: "Open chat",
  COMMAND_MEMORIES: "Open memories",
  COMMAND_PLACEMENT: "Open GPU placement",
  COMMAND_PLACEMENT_BESIDE_CHAT: "Show GPU activity beside chat",
  COMMAND_REMEMBER: "Remember\u2026",
  COMMAND_ADD_FILE: "Add current file",
  COMMAND_ADD_FOLDER: "Add current folder",
  COMMAND_SYNC: "Sync vault",
  COMMAND_SYNC_RETRY_SKIPPED: "Retry skipped documents",
  COMMAND_SYNC_REBUILD: "Rebuild index",
  COMMAND_EXPORT_DATASET: "Export dataset",
  COMMAND_IMPORT_DATASET: "Import dataset",
  COMMAND_CATALOG: "Browse model catalog",
  COMMAND_CRAWL: "Crawl web page",
  COMMAND_DOCUMENTS: "Browse documents",
  COMMAND_SETUP: "Run setup wizard",
  COMMAND_TASKS: "Show task center",
  COMMAND_STATUS: "Show status",
  // Status modal
  TITLE_STATUS: "lilbee Status",
  LABEL_STATUS_DOCUMENTS: "Documents",
  LABEL_STATUS_CHUNKS: "Chunks",
  LABEL_STATUS_CHAT_MODEL: "Chat model",
  LABEL_STATUS_OCR: "OCR",
  STATUS_VALUE_OCR_AUTO: "Auto",
  STATUS_VALUE_OCR_ON: "On",
  STATUS_VALUE_OCR_OFF: "Off",
  LABEL_STATUS_ARCHITECTURE: "Architecture",
  LABEL_STATUS_CONTEXT_LENGTH: "Context length",
  LABEL_STATUS_SERVED_CONTEXT: "Serving context",
  LABEL_STATUS_WIKI: "Wiki",
  LABEL_STATUS_WIKI_PAGES: "Pages",
  LABEL_STATUS_WIKI_DRAFTS: "Drafts",
  LABEL_STATUS_WIKI_LAST_LINT: "Last lint",
  LABEL_STATUS_NONE: "none",
  LABEL_STATUS_NOT_AVAILABLE: "n/a",
  LABEL_STATUS_ENABLED: "enabled",
  LABEL_STATUS_DISABLED: "disabled",
  COMMAND_ADD_TO_LILBEE: "Add to lilbee",
  // Wiki view
  LABEL_WIKI_VIEW: "lilbee Wiki",
  LABEL_WIKI: "Wiki",
  LABEL_WIKI_SUMMARIES: "Summaries",
  LABEL_WIKI_CONCEPTS: "Concepts",
  LABEL_WIKI_ENTITIES: "Entities",
  LABEL_WIKI_UNWRITTEN: (count) => `Not written yet (${count})`,
  LABEL_WIKI_NOT_WRITTEN: "not written yet",
  LABEL_WIKI_WRITING: "writing...",
  CONFIRM_WIKI_GENERATE: (name) => `Write a wiki page for "${name}"? This runs the chat model once and can take a few minutes on a large model.`,
  TASK_WIKI_GENERATE: (name) => `Write ${name}`,
  NOTICE_WIKI_GENERATED: (name) => `lilbee: wrote "${name}"`,
  LABEL_WIKI_NO_PAGES: "No wiki pages yet",
  LABEL_WIKI_SOURCES_COUNT: (n) => `${n} sources`,
  // Citation modal
  TITLE_CITATIONS: "Citation provenance",
  LABEL_CITATION_FACT: "fact",
  LABEL_CITATION_INFERENCE: "inference",
  LABEL_CITATION_CURRENT: "current",
  LABEL_CITATION_STALE: "stale",
  // Drafts
  TITLE_DRAFTS: (n) => `Wiki drafts (${n})`,
  LABEL_DRAFT_REFRESH: "Refresh",
  LABEL_DRAFT_ACCEPT: "Accept",
  LABEL_DRAFT_REJECT: "Reject",
  LABEL_DRAFT_NO_SELECTION: "Select a draft to see its diff.",
  LABEL_DRAFT_NO_DIFF: "No diff (draft has no published counterpart).",
  LABEL_DRAFT_KIND_DRIFT: "DRIFT",
  LABEL_DRAFT_KIND_PARSE: "PARSE",
  LABEL_DRAFT_KIND_COLLISION: "COLLISION",
  LABEL_DRAFT_KIND_LOW_FAITH: "LOW FAITH",
  LABEL_DRAFT_KIND_BAD_TITLE: "BAD TITLE",
  LABEL_DRAFT_PUBLISHED: "pub",
  LABEL_DRAFT_NEW: "new",
  LABEL_DRAFT_FAITH_NA: "faith \u2014",
  LABEL_DRAFT_FAITH: (score) => `faith ${score.toFixed(2)}`,
  LABEL_DRAFT_DRIFT: (pct) => `${pct}% drift`,
  LABEL_NO_DRAFTS: "No pending wiki drafts.",
  COMMAND_REVIEW_DRAFTS: "Review wiki drafts",
  NOTICE_CONFIRM_DRAFT_ACCEPT: (slug) => `Accept draft "${slug}"? This overwrites the published page and re-indexes its chunks.`,
  NOTICE_CONFIRM_DRAFT_REJECT: (slug) => `Reject draft "${slug}"? The draft file will be deleted.`,
  NOTICE_DRAFT_ACCEPTED: (slug, chunks) => `Accepted ${slug} (${chunks} chunks indexed).`,
  NOTICE_DRAFT_REJECTED: (slug) => `Rejected ${slug}.`,
  NOTICE_DRAFT_ACTION_FAILED: "Draft action failed. Check the server log.",
  ERROR_LOAD_PAGE: "Failed to load page.",
  ERROR_LOAD_CITATIONS: "Failed to load citations.",
  ERROR_LOAD_DRAFTS: "Failed to load drafts.",
  ERROR_LOAD_DIFF: "Failed to load diff.",
  LABEL_NO_CITATIONS: "No citations found.",
  // Source preview modal (external server / non-vault sources)
  TITLE_SOURCE_PREVIEW: "Source preview",
  LABEL_PREVIEW_CLOSE: "Close",
  LABEL_PREVIEW_SAVE_TO_VAULT: "Save to vault",
  LABEL_PREVIEW_OPEN_IN_VAULT: "Open in vault",
  TOOLTIP_PREVIEW_SAVE_SOON: "Coming soon \u2014 available once the server supports vault storage.",
  ERROR_PREVIEW_INVALID_SOURCE: "Cannot preview: source reference is empty.",
  ERROR_PREVIEW_LOAD: (reason) => `Failed to load source: ${reason}`,
  ERROR_PREVIEW_UNSUPPORTED: (mime) => `Cannot preview content of type "${mime}". Open the original file in your vault to view it.`,
  // Lint
  TITLE_LINT_RESULTS: "Wiki lint results",
  LABEL_LINT_ISSUES: (n, pages) => `${n} issues across ${pages} pages`,
  LABEL_LINT_STATUS_VALID: "valid",
  LABEL_LINT_STATUS_STALE: "stale hash",
  LABEL_LINT_STATUS_DELETED: "source deleted",
  LABEL_LINT_STATUS_MISSING: "excerpt missing",
  LABEL_LINT_STATUS_MODEL: "model changed",
  // Wiki settings
  // Retrieval quality (server PR #557)
  LABEL_TITLE_SEARCH: "Match on titles",
  DESC_TITLE_SEARCH: "Also search document titles, not just their text. Helps when you remember what a file is called but not what it says.",
  LABEL_TITLE_SEARCH_WEIGHT: "Title weight",
  DESC_TITLE_SEARCH_WEIGHT: "How much a title match counts next to a body match. Higher favours the title.",
  LABEL_ADAPTIVE_FUSION: "Adaptive fusion",
  DESC_ADAPTIVE_FUSION: "Let the server decide per query how much to trust keyword matching against meaning matching.",
  LABEL_ADAPTIVE_FUSION_MARGIN: "Fusion margin",
  DESC_ADAPTIVE_FUSION_MARGIN: "How clear a lead one method needs before the server leans on it.",
  LABEL_LEXICAL_FUSION_WEIGHT: "Keyword weight",
  DESC_LEXICAL_FUSION_WEIGHT: "How much keyword matching counts when results are combined.",
  LABEL_NEIGHBOR_EXPANSION: "Include neighbouring text",
  DESC_NEIGHBOR_EXPANSION: "Pull in this many passages either side of a match, so an answer is not cut off mid-thought. 0 keeps just the match.",
  LABEL_FILTER_STRUCTURAL_CHUNKS: "Skip boilerplate",
  DESC_FILTER_STRUCTURAL_CHUNKS: "Drop tables of contents, headers and footers from results.",
  LABEL_RERANK_MIN_SCORE: "Reranker cutoff",
  DESC_RERANK_MIN_SCORE: "Discard reranked results below this score. Leave empty to keep everything the reranker returns.",
  LABEL_FTS_LANGUAGE: "Keyword search language",
  DESC_FTS_LANGUAGE: "Language used for stemming in keyword search, so 'running' matches 'run'.",
  LABEL_CONTEXTUAL_ENRICHMENT: "Add context when indexing",
  DESC_CONTEXTUAL_ENRICHMENT: "Give each passage a short note about where it sits in the document. Makes retrieval better and indexing slower.",
  LABEL_EMBED_TITLES: "Index titles with text",
  DESC_EMBED_TITLES: "Fold the document title into each passage as it is indexed.",
  LABEL_TOKEN_SIZING: "Size passages by tokens",
  DESC_TOKEN_SIZING: "Split documents on token counts rather than characters, so passages fit the model more predictably.",
  // Extraction quality (xberg 1.0)
  LABEL_LAYOUT_DETECTION: "Detect page layout",
  DESC_LAYOUT_DETECTION: "Work out columns, headings and reading order before extracting. Much better on PDFs with complex layouts, and noticeably slower to ingest, which is why it is off by default.",
  LABEL_TABLE_EXTRACTION: "Extract tables",
  DESC_TABLE_EXTRACTION: "Pull tables out as tables instead of flattening them into a run of text.",
  LABEL_TABLE_MODEL: "Table model",
  DESC_TABLE_MODEL: "Which model reads tables. Auto suits most documents; the wired and wireless variants suit tables with and without ruling lines.",
  LABEL_OCR_LANGUAGE: "OCR languages",
  DESC_OCR_LANGUAGE: "Languages to expect when reading scanned pages, one per line. Three-letter codes, for example eng or deu.",
  // Wiki
  LABEL_WIKI_AUTO_UPDATE: "Update the wiki after ingesting",
  DESC_WIKI_AUTO_UPDATE: "Refresh wiki pages whenever documents are added. This is GPU work, so leave it off if you would rather run it yourself.",
  LABEL_WIKI_STUB_MAX_CHUNK_REFS: "Passages per page",
  DESC_WIKI_STUB_MAX_CHUNK_REFS: "How many source passages a generated page may draw on.",
  LABEL_WIKI_ENTITY_PAGE_PROMPT: "Entity page prompt",
  DESC_WIKI_ENTITY_PAGE_PROMPT: "The instructions used to write a page about a person, place or thing. Leave empty for the built-in prompt.",
  // Engine, placement and ingest
  LABEL_INGEST_PROCESSES: "Ingest workers",
  DESC_INGEST_PROCESSES: "How many documents are processed at once. 0 lets the server pick based on your machine.",
  LABEL_SYSTEM_MEMORY_RESERVE_GB: "Memory to leave free",
  DESC_SYSTEM_MEMORY_RESERVE_GB: "Gigabytes of system memory to keep for everything else, so loading a model does not starve your machine.",
  LABEL_USABLE_VRAM_FRACTION: "Usable VRAM",
  DESC_USABLE_VRAM_FRACTION: "Fraction of each card's memory the planner may fill. Lower it if other software shares the GPU.",
  LABEL_FAST_MODEL_DOWNLOADS: "Fast model downloads",
  DESC_FAST_MODEL_DOWNLOADS: "Download models over several connections at once. Much faster on a good link, heavier on a weak one.",
  LABEL_WIKI_SECTION: "Wiki (beta)",
  LABEL_WIKI_ENABLE_TOGGLE: "Enable wiki",
  DESC_WIKI_ENABLE_TOGGLE: "Generate AI-written summaries of your documents. This feature is in beta.",
  LABEL_WIKI_STATUS: "Wiki status",
  LABEL_WIKI_PRUNE_RAW: "Remove source duplicates",
  LABEL_WIKI_FAITHFULNESS: "Summary accuracy",
  LABEL_WIKI_SEARCH_MODE: "Default search mode",
  LABEL_WIKI_RUN_LINT: "Check wiki health",
  LABEL_WIKI_RUN_PRUNE: "Clean up wiki",
  DESC_WIKI_PRUNE_RAW: "After wiki summaries are created, remove the original text chunks that were summarized",
  DESC_WIKI_FAITHFULNESS: "How accurate wiki summaries must be. Higher = stricter quality, lower = more content",
  DESC_WIKI_RUN_LINT: "Scan wiki pages for broken references, missing sources, or outdated content",
  DESC_WIKI_RUN_PRUNE: "Remove wiki pages that are outdated or no longer have valid sources",
  DESC_WIKI_SEARCH_MODE: "Which chunks to search by default",
  LABEL_WIKI_SYNC_TO_VAULT: "Sync wiki to vault",
  DESC_WIKI_SYNC_TO_VAULT: "Write wiki pages as files in your vault so they appear in graph view, search, and backlinks",
  LABEL_WIKI_VAULT_FOLDER: "Wiki vault folder",
  DESC_WIKI_VAULT_FOLDER: "Folder in your vault where wiki pages are written",
  NOTICE_WIKI_SYNC: (written, removed) => `lilbee: wiki sync \u2014 ${written} written, ${removed} removed`,
  // Search mode
  LABEL_SEARCH_ALL: "All",
  LABEL_SEARCH_WIKI: "Wiki",
  LABEL_SEARCH_RAW: "Raw",
  // Wiki tasks/notices
  NOTICE_WIKI_LINT_DONE: (issues) => `lilbee: lint complete \u2014 ${issues} issues found`,
  NOTICE_WIKI_UPDATE_DONE: (count) => `lilbee: wiki updated, ${count} pages`,
  NOTICE_WIKI_PRUNE_DONE: (archived) => `lilbee: pruned ${archived} pages`,
  NOTICE_WIKI_PRUNE_CONFIRM: "This will archive wiki pages with broken citations. Continue?",
  // Wiki commands
  COMMAND_WIKI: "Browse wiki",
  COMMAND_WIKI_LINT: "Run wiki lint",
  COMMAND_WIKI_UPDATE: "Update wiki",
  TASK_WIKI_UPDATE: "Update wiki",
  TASK_WIKI_PAGE: (label, current, total) => total > 0 ? `${label} (${current} of ${total})` : label,
  TASK_WIKI_PHASE: (phase) => {
    const phases = {
      extract: "Finding entities",
      generate: "Writing pages",
      index: "Building the index"
    };
    return phases[phase] ?? phase;
  },
  WIZARD_INTRO_DESC: "lilbee turns your Obsidian vault into a searchable knowledge base powered by AI.",
  WIZARD_INTRO_STEPS: "This wizard will help you:",
  WIZARD_STEP_CHOOSE_SERVER: "Choose where lilbee runs (this machine, or an existing server)",
  WIZARD_STEP_CHOOSE_MODEL: "Choose an AI model that fits the host's RAM",
  WIZARD_STEP_INDEX: "Index your vault so you can search and chat",
  WIZARD_LOCAL_ONLY_MANAGED: "Managed mode runs on this machine \u2014 your notes never leave your laptop.",
  WIZARD_LOCAL_ONLY_EXTERNAL: "External mode talks to your existing lilbee server. Your notes stay on whichever host runs it.",
  WIZARD_MODEL_HELP: "This is the AI that answers your questions about your notes. Bigger models are smarter but need more RAM and disk space.",
  WIZARD_SYSTEM_RAM: "Your system: {ram} GB RAM",
  WIZARD_SYNC_HELP: "lilbee needs to read your notes once to make them searchable. This happens locally on your machine.",
  WIZARD_STEP_BADGE: "Step {num} \xB7 {label}",
  WIZARD_PROGRESS_BACKGROUND: "Downloads continue in the background.",
  WIZARD_WIKI_TRADEOFFS_LABEL: "See the tradeoffs",
  WIZARD_SUMMARY_HEADING: "Setup complete",
  WIZARD_SUMMARY_MODEL: "Chat model: {model}",
  WIZARD_SUMMARY_FILES: "{count} files indexed",
  WIZARD_SUMMARY_PROCESSED: "{count} files processed",
  WIZARD_TIPS: "What to try next",
  WIZARD_TIP_CHAT: "Open the chat panel to ask questions about your notes",
  WIZARD_TIP_SEARCH: "Use the search command to find specific content",
  WIZARD_TIP_DRAG: "Drag files into the chat to add context",
  WIZARD_CHANGE_SETTINGS: "You can change models and settings anytime in the lilbee settings tab.",
  WIZARD_MANAGED_DESC: "lilbee starts and stops automatically with Obsidian. No terminal needed.",
  WIZARD_EXTERNAL_DESC: "You run the lilbee server yourself. For advanced users or shared setups.",
  WIZARD_STATUS_STARTING: "Starting...",
  WIZARD_SELECT_MODEL: "Please select a model first.",
  // Wiki wizard step
  WIZARD_WIKI_TITLE: "Wiki (optional)",
  WIZARD_WIKI_DESC: "Wiki pages are AI-written summaries of your documents, like Wikipedia articles derived from what you already have. Generation runs on demand from the command palette or Settings; enabling it here just unlocks those controls.",
  WIZARD_WIKI_CAVEATS_HEADING: "Before you turn this on",
  WIZARD_WIKI_CAVEATS_INTRO: "Two things worth knowing:",
  WIZARD_WIKI_CAVEAT_QUALITY: "Everything lands as a draft first. Every page is gated by a title/body coherence check and a cosine-similarity score against the source chunks, then ships as a reviewable draft. Accept, edit, or reject it from the drafts panel before it becomes a published page.",
  WIZARD_WIKI_CAVEAT_COST: "Building the wiki is the heaviest thing lilbee does. It runs your chat model over the whole corpus and holds the GPU for the duration, so chat is unavailable while it works. Pages sharing a primary source are batched into one call, so a 200-page vault over roughly 30 sources costs about 30 calls rather than 200. Run it during a break, not in the middle of research.",
  TOOLTIP_WIZARD_WIKI_ENABLE: "Turning this on only unlocks the commands. Nothing is generated until you run a build, and a build is GPU heavy: it runs your chat model across every source and blocks chat while it does. Pages arrive as drafts for you to review.",
  WIZARD_WIKI_PROS_HEADING: "What it adds",
  WIZARD_WIKI_PRO_SUMMARIES: "Summarized, structured overviews of your documents",
  WIZARD_WIKI_PRO_CROSSREFS: "Related concepts become discoverable through cross-references",
  WIZARD_WIKI_PRO_ANSWERS: "Chat and search can reference wiki pages for more coherent answers",
  WIZARD_WIKI_CONS_HEADING: "Worth knowing",
  WIZARD_WIKI_CON_TOKENS: "Each page run uses LLM compute / API tokens",
  WIZARD_WIKI_CON_ACCURACY: "Small models can hallucinate \u2014 always verify against source",
  WIZARD_WIKI_CON_SEARCH: "Search may prioritise wiki chunks over raw ones if you include both",
  WIZARD_WIKI_CON_COMPLEXITY: "Adds a second index shape to maintain alongside raw embeddings",
  WIZARD_WIKI_ENABLE: "Enable wiki (on-demand generation)",
  WIZARD_WIKI_DISABLE: "Skip for now (recommended)",
  WIZARD_WIKI_ENABLE_DESC: "Unlocks the wiki commands and settings. Nothing generates until you ask for it.",
  WIZARD_WIKI_DISABLE_DESC: "Use raw document search only. You can enable the wiki later from Settings \u2192 Wiki, or re-open this wizard from Settings \u2192 Setup wizard.",
  TITLE_PICK_EMBEDDING: "Pick an embedding model",
  WIZARD_EMBEDDING_HELP: "The embedding model converts your documents into searchable vectors. The default works well for most users.",
  WIZARD_EMBEDDING_RECOMMENDED: "Recommended",
  WIZARD_FILE_PICKER_VAULT: "From vault",
  WIZARD_FILE_PICKER_DISK: "Files from disk",
  WIZARD_FOLDER_PICKER_DISK: "Folder from disk",
  WIZARD_CRAWL_WEB: "Crawl web page",
  // Managed-mode consent modal
  MANAGED_CONSENT_TITLE: "How should lilbee run?",
  MANAGED_CONSENT_SUBTITLE: "lilbee indexes your vault from a local server. Pick who runs it.",
  MANAGED_CONSENT_PILL_RECOMMENDED: "Recommended",
  MANAGED_CONSENT_CARD_MANAGED_TITLE: "Managed",
  MANAGED_CONSENT_CARD_MANAGED_DESC: "This plugin downloads the server and handles start, stop, and updates. Nothing else to install.",
  MANAGED_CONSENT_CARD_EXTERNAL_TITLE: "External",
  MANAGED_CONSENT_CARD_EXTERNAL_DESC: "You run lilbee serve yourself. The plugin connects to it.",
  MANAGED_CONSENT_CARD_EXTERNAL_HINT: "For advanced / custom setups",
  MANAGED_CONSENT_CONFIGURE_LINK: "Set your server URL in Settings",
  MANAGED_CONSENT_PROV_LABEL: "Source \xB7 verified",
  MANAGED_CONSENT_PROV_PENDING: "Fetching release info\u2026",
  MANAGED_CONSENT_PROV_FAILED: "(release info unavailable)",
  MANAGED_CONSENT_PROV_RELEASE_NOTES: "View release notes \u2197",
  MANAGED_CONSENT_PROV_ONE_TIME: "one-time",
  MANAGED_CONSENT_BTN_CANCEL: "Cancel",
  MANAGED_CONSENT_BTN_DOWNLOAD: "\u2193 Download & manage server",
  NOTICE_SERVER_DOWNLOAD_CANCELED: "Server download canceled.",
  NOTICE_SWITCHED_TO_EXTERNAL: "Switched to external mode. Set your server URL in Settings to connect.",
  // Chat-view model rail
  RAIL_LABEL_CHAT: "Chat",
  RAIL_LABEL_EMBED: "Embed",
  RAIL_LABEL_VISION: "Vision",
  RAIL_LABEL_RERANK: "Rerank",
  RAIL_BROWSE_CATALOG: "Browse catalog\u2026",
  // GPU placement / fleet
  LABEL_PLACEMENT_VIEW: "lilbee GPU placement",
  PLACEMENT_TITLE: "GPU placement",
  PLACEMENT_SECTION_HARDWARE: "Hardware",
  PLACEMENT_SECTION_ROLES: "Roles",
  PLACEMENT_HOST_APPLE: "Apple Silicon",
  PLACEMENT_HOST_APPLE_SUB: "unified memory \xB7 Metal",
  PLACEMENT_HOST_CPU: "CPU",
  PLACEMENT_HOST_CPU_SUB: "no GPU detected",
  PLACEMENT_STATE_AUTO: "auto",
  PLACEMENT_STATE_MANUAL: "manual",
  PLACEMENT_STATE_EDITED: "edited",
  PLACEMENT_STATE_APPLYING: "applying\u2026",
  PLACEMENT_AUTO_MANAGED: "Auto-managed. The planner balances roles across your hardware.",
  PLACEMENT_EDIT: "Edit manually",
  PLACEMENT_PREVIEW: "Preview",
  PLACEMENT_APPLY: "Apply",
  PLACEMENT_RESET: "Reset to auto",
  PLACEMENT_FITS: "Fits all roles",
  PLACEMENT_WONT_FIT: (roles) => `Won't fit: ${roles}. Move it to another GPU or free up memory.`,
  PLACEMENT_NOT_SET: "not set",
  PLACEMENT_TIP_CHIP: (role, gpu) => `Run ${roleNoun(role)} on ${gpu}`,
  PLACEMENT_TIP_REPLICA_ADD: (role) => `Add ${indefinite(roleNoun(role))} ${roleNoun(role)} worker`,
  PLACEMENT_TIP_REPLICA_REMOVE: (role) => `Remove ${indefinite(roleNoun(role))} ${roleNoun(role)} worker`,
  PLACEMENT_HINT_EDIT_MANUALLY: 'Click "Edit manually" first to change GPU placement.',
  PLACEMENT_HINT_REPLICAS_SETTINGS: "This device runs everything together. Set worker counts in Settings \u2192 lilbee \u2192 Hardware / fleet.",
  PLACEMENT_MEM_FREE: (free, total) => `${free} / ${total} free`,
  PLACEMENT_MEM_UNIFIED: (total) => `${total} unified`,
  PLACEMENT_ROLE_VRAM: (size) => `~${size}`,
  PLACEMENT_TIP_ROLE_VRAM: (role) => `Estimated memory the ${roleNoun(role)} model needs`,
  PLACEMENT_UTIL: (pct) => `${pct}%`,
  PLACEMENT_UTIL_NA: "\u2014",
  PLACEMENT_METER_UTIL: "util",
  PLACEMENT_METER_VRAM: "vram",
  PLACEMENT_HINT_SPLIT: "split",
  PLACEMENT_HINT_MIRROR: "mirror",
  PLACEMENT_HINT_SINGLE: "one card",
  PLACEMENT_REBUILDING: "Rebuilding fleet\u2026",
  PLACEMENT_APPLIED: "Placement applied.",
  PLACEMENT_RESET_DONE: "Back to automatic placement.",
  PLACEMENT_APPLY_NOT_ENABLED: "Applying placement isn't enabled on this lilbee server.",
  PLACEMENT_APPLY_FAILED: (msg) => `Couldn't apply placement: ${msg}`,
  PLACEMENT_LOAD_FAILED: (msg) => `Couldn't load placement: ${msg}`,
  PLACEMENT_UPDATE_SERVER_PROMPT: "GPU placement and monitoring need lilbee server 0.6.90 or newer. Continue to Settings to update the server.",
  PLACEMENT_NEEDS_NEWER_SERVER: "GPU placement and monitoring aren't available on this lilbee server. Update the server to 0.6.90 or newer, then reopen this view.",
  PLACEMENT_WAITING_SERVER: "Waiting for the lilbee server to start. This view loads automatically once it's up.",
  PLACEMENT_GPU_NOTICE: (notice) => `GPU monitoring: ${notice}`,
  PLACEMENT_GPU_NOTICE_TOOLTIP: "The lilbee server can't read GPU utilization on this host. The hint below tells you which tool to install or permission to grant.",
  // Hardware / fleet settings
  LABEL_FLEET: "Hardware / fleet",
  LABEL_FLEET_HELP: "How the model fleet uses your GPUs. These apply to local (managed) and self-hosted servers; they have no effect when lilbee points at a hosted provider.",
  LABEL_FLASH_ATTENTION: "Flash attention",
  DESC_FLASH_ATTENTION: "Faster attention kernels that cut chat context memory on supported GPUs. Reset to let lilbee decide per model.",
  LABEL_KV_CACHE_TYPE: "KV cache type",
  DESC_KV_CACHE_TYPE: "Smaller types use less memory for the chat context. q8_0 roughly halves it versus f16 with no noticeable quality loss; q4_0 quarters it.",
  LABEL_N_GPU_LAYERS: "GPU layers (chat)",
  DESC_N_GPU_LAYERS: "How many chat-model layers to offload to the GPU. Leave empty to offload all; lower it to fit a large model in limited VRAM.",
  LABEL_EMBED_REPLICAS: "Embedding replicas",
  DESC_EMBED_REPLICAS: "How many embedding workers to run while indexing. 0 lets lilbee pick (one per GPU).",
  LABEL_VISION_REPLICAS: "Vision replicas",
  DESC_VISION_REPLICAS: "How many OCR workers to run while indexing. 0 lets lilbee pick (one per GPU).",
  LABEL_GPU_DEVICES: "Visible GPUs",
  DESC_GPU_DEVICES: "Restrict lilbee to specific GPUs by index, comma separated (for example 0,1). Leave empty to use all.",
  PLACEHOLDER_GPU_DEVICES: "all",
  // Memory
  LABEL_MEMORIES_VIEW: "lilbee Memories",
  LABEL_MEMORIES_TITLE: "Memories",
  MEMORIES_SEARCH_PLACEHOLDER: "Filter memories\u2026",
  MEMORIES_FLAG_YES: "yes",
  MEMORIES_FLAG_NO: "no",
  MEMORIES_EMPTY: "No memories stored. Use the Remember command to add one.",
  MEMORIES_DISABLED: "Memory is off. Enable it in Settings \u2192 lilbee \u2192 Memory.",
  MEMORIES_LOAD_FAILED: (detail) => `Failed to load memories: ${detail}`,
  MEMORIES_DELETE_CONFIRM: "Delete this memory? This cannot be undone.",
  MEMORIES_DELETED: "Deleted memory",
  MEMORIES_DELETE_FAILED: (detail) => `Delete failed: ${detail}`,
  MEMORIES_SHARED_ON: "Shared with agents",
  MEMORIES_SHARED_OFF: "No longer shared with agents",
  MEMORIES_FLAG_FAILED: (detail) => `Update failed: ${detail}`,
  MEMORIES_DELETE_TOOLTIP: "Delete memory",
  MEMORIES_SHARE_TOOLTIP: "Toggle sharing with agents",
  BUTTON_ADD_MEMORY: "Add memory",
  LABEL_REMEMBER_TITLE: "Remember",
  LABEL_REMEMBER_TEXT_LABEL: "Memory",
  LABEL_REMEMBER_TEXT_PLACEHOLDER: "What should lilbee remember?",
  LABEL_REMEMBER_KIND_LABEL: "Kind",
  LABEL_REMEMBER_KIND_FACT: "Fact",
  LABEL_REMEMBER_KIND_PREFERENCE: "Preference",
  LABEL_REMEMBER_SHARED_LABEL: "Share with agents",
  BUTTON_REMEMBER: "Remember",
  REMEMBER_EMPTY: "Enter something to remember.",
  REMEMBER_SUCCESS: (kind) => `Remembered (${kind}).`,
  REMEMBER_FAILED: (detail) => `Could not save the memory: ${detail}`,
  MEMORY_EXTRACTED_NOTICE: (count) => `Noted ${count} ${count === 1 ? "memory" : "memories"} to review in Memories.`,
  LABEL_MEMORY_SECTION: "Memory",
  LABEL_MEMORY_ENABLED: "Enable memory",
  DESC_MEMORY_ENABLED: "Let lilbee recall saved facts and preferences during chat. Requires an embedding model.",
  LABEL_MEMORY_AUTO_EXTRACT: "Auto-extract memories from chat",
  DESC_MEMORY_AUTO_EXTRACT: "After each answer, lilbee proposes memories to save. Review them in the Memories view.",
  NOTICE_MEMORY_CONFIG_FAILED: "lilbee: could not update memory settings",
  // Diagnostics export
  DIAG_REVIEW_WARNING: "Review this bundle before sharing. Secrets are redacted, but log lines can include file paths and note titles.",
  DIAG_REMOTE_SERVER_NOTE: "External server data dir is not locally readable; server logs must be fetched from the machine running lilbee serve.",
  BUTTON_EXPORT_DIAGNOSTICS: "Export diagnostics",
  LABEL_EXPORT_DIAGNOSTICS: "Diagnostics",
  DESC_EXPORT_DIAGNOSTICS: "Bundle logs, settings (secrets removed), and recent errors into a zip you can attach to a bug report.",
  NOTICE_DIAGNOSTICS_EXPORTED: (path) => `Diagnostics saved to ${path}. The summary is on your clipboard. Review the contents before sharing.`,
  NOTICE_DIAGNOSTICS_SUMMARY_ONLY: (path) => `Zip creation failed; wrote summary.md to ${path} instead. Review the contents before sharing.`,
  NOTICE_DIAGNOSTICS_FAILED: (detail) => `Diagnostics export failed: ${detail}`,
  // Agent integration
  LABEL_AGENT_SECTION: "Agent integration",
  DESC_AGENT_SECTION: "Connect a coding agent to lilbee, so it thinks with your models and can search your vault.",
  LABEL_AGENT_SUPPORTED: "Supported agents",
  BUTTON_AGENT_RESCAN: "Rescan",
  LABEL_AGENT_CHOICE: "Coding agent",
  DESC_AGENT_CHOICE: "The agent lilbee connects to your models. Installed agents appear here.",
  AGENT_OPTION_NONE: "None",
  LABEL_AGENT_KEEP_FRESH: "Keep the agent connected",
  DESC_AGENT_KEEP_FRESH: "Reconnect the agent to your models automatically after a restart.",
  LABEL_AGENT_MODEL: "Agent model",
  BUTTON_AGENT_CHANGE_MODEL: "Change model",
  AGENT_CONTEXT_BADGE: (tokens) => `${Math.round(tokens / 1e3)}k context`,
  AGENT_CONTEXT_UNKNOWN: "Context window unknown until the model loads.",
  AGENT_CONTEXT_WARNING: "Coding agents need strong tool calling and a large context window.",
  LABEL_AGENT_CLAUDIAN: "Claudian panel",
  DESC_AGENT_CLAUDIAN_CONFIGURED: "Claudian's coding agent now runs on your models.",
  PILL_AGENT_CLAUDIAN_CONFIGURED: "Connected",
  BUTTON_OPEN_CLAUDIAN: "Open Claudian",
  DESC_AGENT_CLAUDIAN_MISSING: "Claudian brings a coding agent into Obsidian. Install it from the community plugin store to chat with the agent without leaving your vault.",
  DESC_AGENT_CLAUDIAN_SKIPPED: "Finish connecting the agent in Claudian's settings.",
  AGENT_STATUS_CONNECTED: "Connected to your models",
  AGENT_STATUS_PENDING: "Connects when the server starts.",
  AGENT_DETECT_UNAVAILABLE: "lilbee could not check for agents. Make sure the server is running, then rescan.",
  AGENT_STATUS_GLOBAL: "Hermes uses one global config. Copy the block below into it.",
  LABEL_AGENT_COPY_CONFIG: "Config to copy",
  BUTTON_AGENT_COPY: "Copy",
  NOTICE_AGENT_COPIED: "Config copied.",
  NOTICE_AGENT_CONNECTED: (agent) => `${agent} is connected to lilbee.`,
  NOTICE_AGENT_CONNECTED_GLOBAL: (agent) => `${agent} config is ready to copy from lilbee's settings.`,
  NOTICE_AGENT_CONFIG_FAILED: (detail) => `lilbee could not connect the agent: ${detail}`,
  NOTICE_CLAUDIAN_UPDATED: "Reload Claudian to finish connecting.",
  BUTTON_RELOAD_CLAUDIAN: "Reload Claudian",
  ERROR_AGENT_CONFIG_UNREADABLE: (path) => `${path} is not valid JSON, so lilbee left it alone. Fix or delete it and try again.`,
  ERROR_AGENT_CONFIG_EMPTY: (client) => `The server returned no ${client} config to write.`,
  // Agent picker modal
  AGENT_PICKER_TITLE: "Connect a coding agent",
  AGENT_PICKER_SUBTITLE: "lilbee found an agent on this machine. Want it to work with this vault?",
  AGENT_PICKER_OPENCODE_DESC: "Full pairing: your lilbee models are the agent's brain, vault search included.",
  AGENT_PICKER_BADGE_CLAUDIAN: "works with Claudian",
  AGENT_PICKER_CLAUDE_DESC: "Gets lilbee's vault search and wiki tools. Models stay with Anthropic.",
  AGENT_PICKER_HERMES_DESC: "Runs on your lilbee models with vault search, from its own global config.",
  AGENT_PICKER_NOT_DETECTED: "Not installed",
  AGENT_PICKER_REMEMBER: "Remember my choice",
  BUTTON_AGENT_NOT_NOW: "Not now",
  BUTTON_AGENT_CONNECT: (agent) => `Connect ${agent}`,
  BUTTON_AGENT_CONNECT_NONE: "Connect"
};
var AGENT_LABELS = {
  [AGENT_CLIENT.CLAUDE]: "Claude Code",
  [AGENT_CLIENT.HERMES]: "hermes",
  [AGENT_CLIENT.OPENCODE]: "OpenCode"
};
var AGENT_LINKS = [
  { label: "opencode.ai", url: "https://opencode.ai" },
  { label: "hermes-agent.ai", url: "https://hermes-agent.ai" },
  { label: "claude.com/code", url: "https://claude.com/code" }
];
var FILTERS = {
  TASK: {
    ALL: "",
    CHAT: "chat",
    EMBEDDING: "embedding",
    VISION: "vision",
    RERANK: "rerank"
  },
  SIZE: {
    ALL: "",
    SMALL: "small",
    MEDIUM: "medium",
    LARGE: "large"
  },
  SORT: {
    FEATURED: "featured",
    DOWNLOADS: "downloads",
    NAME: "name",
    SIZE_ASC: "size_asc",
    SIZE_DESC: "size_desc"
  }
};
var TASK_LABELS = {
  [MODEL_TASK.CHAT]: "Chat",
  [MODEL_TASK.VISION]: "Vision",
  [MODEL_TASK.EMBEDDING]: "Embedding",
  [MODEL_TASK.RERANK]: "Rerank"
};
var CATALOG_FILTERS = {
  TASK: [
    [FILTERS.TASK.ALL, MESSAGES.LABEL_ALL_TASKS],
    [FILTERS.TASK.CHAT, TASK_LABELS[MODEL_TASK.CHAT]],
    [FILTERS.TASK.EMBEDDING, TASK_LABELS[MODEL_TASK.EMBEDDING]],
    [FILTERS.TASK.VISION, TASK_LABELS[MODEL_TASK.VISION]],
    [FILTERS.TASK.RERANK, TASK_LABELS[MODEL_TASK.RERANK]]
  ],
  SIZE: [
    [FILTERS.SIZE.ALL, MESSAGES.LABEL_ALL_SIZES],
    [FILTERS.SIZE.SMALL, MESSAGES.LABEL_SIZE_SMALL],
    [FILTERS.SIZE.MEDIUM, MESSAGES.LABEL_SIZE_MEDIUM],
    [FILTERS.SIZE.LARGE, MESSAGES.LABEL_SIZE_LARGE]
  ],
  SORT: [
    [FILTERS.SORT.FEATURED, MESSAGES.LABEL_FEATURED],
    [FILTERS.SORT.DOWNLOADS, MESSAGES.LABEL_DOWNLOADS],
    [FILTERS.SORT.NAME, MESSAGES.LABEL_NAME],
    [FILTERS.SORT.SIZE_ASC, MESSAGES.LABEL_SIZE_ASC],
    [FILTERS.SORT.SIZE_DESC, MESSAGES.LABEL_SIZE_DESC]
  ]
};

// src/result.ts
var Ok = class {
  constructor(value) {
    this.value = value;
  }
  value;
  isOk() {
    return true;
  }
  isErr() {
    return false;
  }
  _unsafeUnwrap() {
    return this.value;
  }
  _unsafeUnwrapErr() {
    throw new Error("Called _unsafeUnwrapErr on an Ok value");
  }
};
var Err = class {
  constructor(error) {
    this.error = error;
  }
  error;
  isOk() {
    return false;
  }
  isErr() {
    return true;
  }
  _unsafeUnwrap() {
    throw new Error("Called _unsafeUnwrap on an Err value");
  }
  _unsafeUnwrapErr() {
    return this.error;
  }
};
function ok(value) {
  return new Ok(value);
}
function err(error) {
  return new Err(error);
}

// src/agent-integration.ts
var OPENCODE_CONFIG_PATH = "opencode.json";
var CLAUDE_MCP_CONFIG_PATH = ".mcp.json";
var CLAUDIAN_PLUGIN_ID = "realclaudian";
var LILBEE_KEY = "lilbee";
var PROVIDER_KEY = "provider";
var MCP_KEY = "mcp";
var MCP_SERVERS_KEY = "mcpServers";
var MODEL_KEY = "model";
var SCHEMA_KEY = "$schema";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function containerAt(source, key) {
  const existing = source[key];
  return isRecord(existing) ? { ...existing } : {};
}
function adoptLilbeeEntry(target2, fresh, key) {
  const freshContainer = fresh[key];
  if (!isRecord(freshContainer) || !(LILBEE_KEY in freshContainer)) return;
  const merged = containerAt(target2, key);
  merged[LILBEE_KEY] = freshContainer[LILBEE_KEY];
  target2[key] = merged;
}
function mergeOpencodeConfig(existing, fresh) {
  const merged = { ...existing ?? {} };
  if (merged[SCHEMA_KEY] === void 0 && fresh[SCHEMA_KEY] !== void 0) {
    merged[SCHEMA_KEY] = fresh[SCHEMA_KEY];
  }
  adoptLilbeeEntry(merged, fresh, PROVIDER_KEY);
  adoptLilbeeEntry(merged, fresh, MCP_KEY);
  if (merged[MODEL_KEY] === void 0 && fresh[MODEL_KEY] !== void 0) {
    merged[MODEL_KEY] = fresh[MODEL_KEY];
  }
  return merged;
}
function mergeClaudeConfig(existing, fresh) {
  const merged = { ...existing ?? {} };
  adoptLilbeeEntry(merged, fresh, MCP_SERVERS_KEY);
  return merged;
}
function agentModelKey(config) {
  const model = config[MODEL_KEY];
  return typeof model === "string" && model !== "" ? model : null;
}
function mergeClaudianData(existing, modelKey) {
  if (!isRecord(existing)) return null;
  const providerConfigs = existing.providerConfigs === void 0 ? {} : existing.providerConfigs;
  if (!isRecord(providerConfigs)) return null;
  const opencode = containerAt(providerConfigs, AGENT_CLIENT.OPENCODE);
  opencode.enabled = true;
  if (modelKey !== null) {
    const visible = opencode.visibleModels;
    const models = Array.isArray(visible) ? [...visible] : [];
    if (!models.includes(modelKey)) models.push(modelKey);
    opencode.visibleModels = models;
  }
  return {
    ...existing,
    providerConfigs: { ...providerConfigs, [AGENT_CLIENT.OPENCODE]: opencode }
  };
}
function pluginsApi(app) {
  return app.plugins ?? null;
}
function isClaudianInstalled(app) {
  const manifests = pluginsApi(app)?.manifests;
  return isRecord(manifests) && CLAUDIAN_PLUGIN_ID in manifests;
}
function isClaudianLoaded(app) {
  return pluginsApi(app)?.enabledPlugins?.has(CLAUDIAN_PLUGIN_ID) === true;
}
async function reloadClaudian(app) {
  const plugins = pluginsApi(app);
  if (!plugins?.disablePlugin || !plugins.enablePlugin) return;
  await plugins.disablePlugin(CLAUDIAN_PLUGIN_ID);
  await plugins.enablePlugin(CLAUDIAN_PLUGIN_ID);
}
var CLAUDIAN_OUTCOME = {
  /** Claudian is not installed, so there was nothing to bridge. */
  ABSENT: "absent",
  WRITTEN: "written",
  UNCHANGED: "unchanged",
  /** Installed, but its data file is not the shape lilbee knows how to edit. */
  SKIPPED: "skipped"
};
var AgentWiring = class {
  constructor(app, api) {
    this.app = app;
    this.api = api;
    this.adapter = app.vault.adapter;
  }
  app;
  api;
  adapter;
  /** Fetch *client*'s config and write it where that client looks for it. */
  async apply(client) {
    const fetched = await this.api.getAgentConfig(client);
    if (fetched.isErr()) return err(fetched.error);
    const config = fetched.value.config;
    if (client === AGENT_CLIENT.HERMES) {
      return ok(this.outcome(client, null, CLAUDIAN_OUTCOME.ABSENT));
    }
    if (!isRecord(config)) {
      return err(new Error(MESSAGES.ERROR_AGENT_CONFIG_EMPTY(client)));
    }
    const path = client === AGENT_CLIENT.OPENCODE ? OPENCODE_CONFIG_PATH : CLAUDE_MCP_CONFIG_PATH;
    const existing = await this.readJson(path);
    if (existing.isErr()) return err(existing.error);
    const merged = client === AGENT_CLIENT.OPENCODE ? mergeOpencodeConfig(existing.value, config) : mergeClaudeConfig(existing.value, config);
    try {
      await this.writeJson(path, merged);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
    const claudian = client === AGENT_CLIENT.OPENCODE ? await this.syncClaudian(agentModelKey(config)) : CLAUDIAN_OUTCOME.ABSENT;
    return ok(this.outcome(client, path, claudian));
  }
  outcome(client, path, claudian) {
    return { client, path, claudian, writtenAt: Date.now() };
  }
  /** Point Claudian's opencode provider at lilbee's models. Never fails the wiring. */
  async syncClaudian(modelKey) {
    if (!isClaudianInstalled(this.app)) return CLAUDIAN_OUTCOME.ABSENT;
    const path = `${this.app.vault.configDir}/plugins/${CLAUDIAN_PLUGIN_ID}/data.json`;
    const existing = await this.readJson(path);
    if (existing.isErr()) return CLAUDIAN_OUTCOME.SKIPPED;
    const merged = mergeClaudianData(existing.value, modelKey);
    if (merged === null) return CLAUDIAN_OUTCOME.SKIPPED;
    if (JSON.stringify(merged) === JSON.stringify(existing.value)) return CLAUDIAN_OUTCOME.UNCHANGED;
    try {
      await this.writeJson(path, merged);
    } catch {
      return CLAUDIAN_OUTCOME.SKIPPED;
    }
    return CLAUDIAN_OUTCOME.WRITTEN;
  }
  /** Null when the file is absent; an error when it exists but cannot be parsed. */
  async readJson(path) {
    if (!await this.adapter.exists(path)) return ok(null);
    let raw;
    try {
      raw = await this.adapter.read(path);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err(new Error(MESSAGES.ERROR_AGENT_CONFIG_UNREADABLE(path)));
    }
    if (!isRecord(parsed)) return err(new Error(MESSAGES.ERROR_AGENT_CONFIG_UNREADABLE(path)));
    return ok(parsed);
  }
  async writeJson(path, value) {
    await this.adapter.write(path, `${JSON.stringify(value, null, 2)}
`);
  }
};

// src/api.ts
var DEFAULT_TIMEOUT_MS = 15e3;
var RETRY_COUNT = 2;
var RETRY_BACKOFF_MS = 500;
var STARTUP_WAIT_MS = 12e3;
var STARTUP_POLL_INTERVAL_MS = 250;
var SessionTokenError = class extends Error {
  status;
  constructor(status, body) {
    super(`Session token invalid (HTTP ${status}): ${body}`);
    this.name = ERROR_NAME.SESSION_TOKEN;
    this.status = status;
  }
};
var ServerStartingError = class extends Error {
  constructor() {
    super("Server is still starting up");
    this.name = ERROR_NAME.SERVER_STARTING;
  }
};
var RateLimitedError = class extends Error {
  retryAfterSeconds;
  constructor(retryAfterSeconds = null) {
    super("lilbee is busy with another request");
    this.name = ERROR_NAME.RATE_LIMITED;
    this.retryAfterSeconds = retryAfterSeconds;
  }
};
function isHttpStatus(error, status) {
  return error.message.startsWith(`Server responded ${status}`);
}
var LilbeeClient = class {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    if (token) this.token = token;
  }
  baseUrl;
  token = null;
  tokenProvider = null;
  outcomeCb = null;
  capabilityCache = /* @__PURE__ */ new Map();
  setToken(token) {
    this.token = token;
  }
  setTokenProvider(provider) {
    this.tokenProvider = provider;
  }
  /** Subscribe to the outcome of every ``fetchWithRetry`` call. */
  setOutcomeCallback(cb) {
    this.outcomeCb = cb;
  }
  recordOutcome(outcome) {
    this.outcomeCb?.(outcome);
  }
  /** Repoint the client at a new base URL in place — lets the wizard update
   * the target server without tearing down the existing client instance. */
  setBaseUrl(url) {
    this.baseUrl = url;
  }
  /** Reachability probe for an arbitrary URL. True on an ok response, false on
   * any error or timeout. Keeps browser fetch inside this module.
   *
   * *token* is explicit rather than optional: the server authenticates every
   * route, so a bare probe of a healthy server comes back 401 and reads as
   * unreachable. Pass null only when there is genuinely no token to send —
   * making it a required argument keeps a future caller from defaulting its
   * way back into that bug. */
  static async probe(url, timeoutMs, token) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await window.fetch(url, {
        signal: controller.signal,
        ...token ? { headers: bearerHeaders(token) } : {}
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  }
  authHeaders() {
    if (!this.token) return {};
    return bearerHeaders(this.token);
  }
  refreshTokenFromProvider() {
    if (!this.tokenProvider) return false;
    const next = this.tokenProvider();
    if (next === null || next === this.token) return false;
    this.token = next;
    return true;
  }
  async assertOk(res) {
    if (res.status === 429) {
      const header = res.headers.get("Retry-After");
      const seconds = header ? parseInt(header, 10) : NaN;
      throw new RateLimitedError(Number.isFinite(seconds) ? seconds : null);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Server responded ${res.status}: ${text}`);
    }
    return res;
  }
  async fetchResult(url, init, opts) {
    try {
      const res = await this.fetchWithRetry(url, init, opts);
      const value = await res.json();
      return ok(value);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
  /**
   * Fetch with automatic retry on network errors and a default timeout.
   * Does NOT retry on HTTP error responses (4xx/5xx) — only on fetch failures
   * (e.g. connection refused, DNS failure, timeout).
   * SSE streams should pass `stream: true` to skip the timeout.
   */
  async fetchWithRetry(url, init, opts) {
    const isRelative = !/^https?:\/\//i.test(url);
    const path = isRelative ? url.startsWith("/") ? url : `/${url}` : null;
    if (!this.baseUrl) {
      const deadline = Date.now() + STARTUP_WAIT_MS;
      while (!this.baseUrl && Date.now() < deadline) {
        await new Promise((r) => window.setTimeout(r, STARTUP_POLL_INTERVAL_MS));
      }
      if (!this.baseUrl) {
        this.recordOutcome(REQUEST_OUTCOME.STARTING);
        throw new ServerStartingError();
      }
    }
    if (path !== null) {
      url = `${this.baseUrl}${path}`;
    }
    const maxAttempts = RETRY_COUNT + 1;
    let lastError;
    let authRetried = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => window.setTimeout(r, RETRY_BACKOFF_MS * attempt));
      }
      try {
        const fetchInit = {
          ...init,
          headers: {
            ...init?.headers ?? {},
            ...this.authHeaders()
          }
        };
        let timer;
        if (opts?.signal) {
          fetchInit.signal = opts.signal;
        } else if (!opts?.stream) {
          const controller = new AbortController();
          fetchInit.signal = controller.signal;
          timer = window.setTimeout(() => controller.abort(), opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        }
        try {
          const res = await window.fetch(url, fetchInit);
          if ((res.status === 401 || res.status === 403) && !authRetried && this.refreshTokenFromProvider()) {
            authRetried = true;
            continue;
          }
          if (res.status === 401 || res.status === 403) {
            const text = await res.text().catch(() => "");
            this.recordOutcome(REQUEST_OUTCOME.AUTH_ERROR);
            throw new SessionTokenError(res.status, text);
          }
          const okRes = await this.assertOk(res);
          this.recordOutcome(REQUEST_OUTCOME.OK);
          return okRes;
        } finally {
          if (timer !== void 0) window.clearTimeout(timer);
        }
      } catch (err3) {
        lastError = err3;
        if (err3 instanceof SessionTokenError) {
          throw err3;
        }
        if (err3 instanceof RateLimitedError) {
          this.recordOutcome(REQUEST_OUTCOME.SERVER_ERROR);
          throw err3;
        }
        if (err3 instanceof Error && err3.message.startsWith("Server responded")) {
          const status = parseInt(err3.message.slice("Server responded ".length), 10);
          this.recordOutcome(status >= 500 ? REQUEST_OUTCOME.SERVER_ERROR : REQUEST_OUTCOME.OK);
          throw err3;
        }
        if (opts?.signal?.aborted) {
          throw err3;
        }
        if (err3 instanceof Error && err3.name === ERROR_NAME.ABORT_ERROR) {
          throw err3;
        }
      }
    }
    this.recordOutcome(REQUEST_OUTCOME.UNREACHABLE);
    throw lastError;
  }
  async health() {
    return this.fetchResult(`${this.baseUrl}/api/health`);
  }
  async status() {
    return this.fetchResult(`${this.baseUrl}/api/status`);
  }
  /** Cached per session; fail-open on probe error (showing a section that won't work degrades better than hiding one the user needs). */
  async getCapability(cap) {
    const cached = this.capabilityCache.get(cap);
    if (cached !== void 0) return cached;
    let value;
    try {
      value = await this.probeCapability(cap);
    } catch {
      value = true;
    }
    this.capabilityCache.set(cap, value);
    return value;
  }
  invalidateCapability(cap) {
    if (cap === void 0) {
      this.capabilityCache.clear();
      return;
    }
    this.capabilityCache.delete(cap);
  }
  async probeCapability(cap) {
    switch (cap) {
      case CAPABILITY.API_KEYS:
        return this.probeLitellmInstalled();
      case CAPABILITY.CRAWLING:
        return this.probeCrawlerInstalled();
      case CAPABILITY.WIKI:
        return this.probeWikiEnabled();
    }
  }
  async probeLitellmInstalled() {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/external`);
    const body = await res.json();
    return body.error === null || body.error === void 0;
  }
  async probeCrawlerInstalled() {
    const res = await this.fetchWithRetry(`${this.baseUrl}/setup/crawler/status`);
    const body = await res.json();
    return body.package_installed === true;
  }
  async probeWikiEnabled() {
    const cfg = await this.config();
    return cfg.wiki === true;
  }
  async search(query, topK, chunkType) {
    const params = new URLSearchParams({ q: query });
    if (topK !== void 0) params.set("top_k", String(topK));
    if (chunkType && chunkType !== SEARCH_CHUNK_TYPE.ALL) params.set("chunk_type", chunkType);
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/search?${params}`);
    return await res.json();
  }
  async listSessions() {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/sessions`);
    const data = await res.json();
    return data.sessions;
  }
  async getSession(sessionId) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`);
    return await res.json();
  }
  /** The server takes no title here; `renameSession` is the only HTTP title write. */
  async createSession(modelRef, scope) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify({ model_ref: modelRef, scope })
    });
    return await res.json();
  }
  async appendSessionMessage(sessionId, role, content, sources = []) {
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: "POST",
        headers: { ...JSON_HEADERS, ...this.authHeaders() },
        body: JSON.stringify({ role, content, sources })
      }
    );
    return await res.json();
  }
  async renameSession(sessionId, title) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify({ title })
    });
    return await res.json();
  }
  async deleteSession(sessionId) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { ...JSON_HEADERS, ...this.authHeaders() }
    });
    return await res.json();
  }
  async listMemories() {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/memories`);
    const data = await res.json();
    return data.memories;
  }
  async remember(text, kind, shared = false) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/memories`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify({ text, kind, shared })
    });
    return await res.json();
  }
  async setMemoryShared(id, shared) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/memories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify({ shared })
    });
    return await res.json();
  }
  async forgetMemory(id) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/memories/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { ...this.authHeaders() }
    });
    return await res.json();
  }
  async *chatStream(question, history, topK, signal, options, chunkType, conversation) {
    const body = { question, history };
    if (topK !== void 0) body.top_k = topK;
    if (options && Object.keys(options).length > 0) body.options = options;
    if (chunkType && chunkType !== SEARCH_CHUNK_TYPE.ALL) body.chunk_type = chunkType;
    if (conversation?.summary) body.summary = conversation.summary;
    if (conversation?.sessionId) body.session_id = conversation.sessionId;
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/chat/stream`,
      {
        method: "POST",
        headers: { ...JSON_HEADERS, ...this.authHeaders() },
        body: JSON.stringify(body)
      },
      { stream: true, signal }
    );
    yield* this.parseSSE(res);
  }
  async *addFiles(paths, force = false, signal, ocrTimeout) {
    const body = { paths, force };
    if (ocrTimeout !== void 0 && ocrTimeout !== null) body.ocr_timeout = ocrTimeout;
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/add`,
      {
        method: "POST",
        headers: { ...JSON_HEADERS, ...this.authHeaders() },
        body: JSON.stringify(body)
      },
      { stream: true, signal }
    );
    yield* this.parseSSE(res);
  }
  /**
   * Upload file CONTENT to /api/add/upload and stream ingest progress. Used
   * when the server is remote (external mode): the plugin can't hand it a
   * server-readable path, so it sends the bytes straight from the vault.
   * FormData sets its own multipart Content-Type, so no JSON header here.
   */
  async *uploadFiles(files, signal) {
    const form = new FormData();
    for (const file of files) form.append("data", new Blob([file.data]), file.name);
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/add/upload`,
      {
        method: "POST",
        headers: { ...this.authHeaders() },
        body: form
      },
      { stream: true, signal }
    );
    yield* this.parseSSE(res);
  }
  async *syncStream(signal, options) {
    const body = {};
    if (options?.forceRebuild) body.force_rebuild = true;
    if (options?.retrySkipped) body.retry_skipped = true;
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/sync`,
      {
        method: "POST",
        headers: { ...JSON_HEADERS, ...this.authHeaders() },
        body: JSON.stringify(body)
      },
      { stream: true, signal }
    );
    yield* this.parseSSE(res);
  }
  async listModels() {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/models`);
    return await res.json();
  }
  async *pullModel(model, source = "native", signal) {
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/models/pull`,
      {
        method: "POST",
        headers: { ...JSON_HEADERS, ...this.authHeaders() },
        body: JSON.stringify({ model, source }),
        signal
      },
      { stream: true }
    );
    yield* this.parseSSE(res);
  }
  async setChatModel(model) {
    return this.fetchResult(`${this.baseUrl}/api/models/chat`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify({ model })
    });
  }
  async catalog(params) {
    const qs = new URLSearchParams();
    if (params?.task) qs.set("task", params.task);
    if (params?.search) qs.set("search", params.search);
    if (params?.size) qs.set("size", params.size);
    if (params?.sort) qs.set("sort", params.sort);
    if (params?.featured !== void 0) qs.set("featured", String(params.featured));
    if (params?.installed !== void 0) qs.set("installed", String(params.installed));
    if (params?.limit !== void 0) qs.set("limit", String(params.limit));
    if (params?.offset !== void 0) qs.set("offset", String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.fetchResult(`${this.baseUrl}/api/models/catalog${suffix}`);
  }
  async installedModels(params) {
    const qs = new URLSearchParams();
    if (params?.task) qs.set("task", params.task);
    const suffix = qs.toString() ? `?${qs}` : "";
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/installed${suffix}`);
    return await res.json();
  }
  async showModel(model) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/models/show`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify({ model })
    });
    return await res.json();
  }
  async deleteModel(model, source = "native") {
    return this.fetchResult(`${this.baseUrl}/api/models/${encodeURIComponent(model)}?source=${source}`, {
      method: "DELETE",
      headers: this.authHeaders()
    });
  }
  async listDocuments(search, limit, offset) {
    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    if (limit !== void 0) qs.set("limit", String(limit));
    if (offset !== void 0) qs.set("offset", String(offset));
    const suffix = qs.toString() ? `?${qs}` : "";
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/documents${suffix}`, {
      headers: this.authHeaders()
    });
    return await res.json();
  }
  async removeDocuments(names, deleteFiles = false) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/documents/remove`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify({ names, delete_files: deleteFiles })
    });
    return await res.json();
  }
  /** Download the per-page text dataset as raw bytes (parquet or jsonl). */
  async exportDataset(format, source) {
    const qs = new URLSearchParams({ format });
    if (source) qs.set("source", source);
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/export?${qs}`, {
      headers: this.authHeaders()
    });
    return res.arrayBuffer();
  }
  /** Upload a per-page text dataset; the server re-embeds it and streams SSE progress. */
  async *importDataset(data, format) {
    const qs = new URLSearchParams({ format });
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/import?${qs}`,
      {
        method: "POST",
        headers: { ...OCTET_STREAM_HEADERS, ...this.authHeaders() },
        // Raw bytes — an ArrayBufferView is a valid fetch body at this serialization boundary.
        body: data
      },
      { stream: true }
    );
    yield* this.parseSSE(res);
  }
  async *crawl(url, depth, maxPages, signal, renderMode, includeSubdomains) {
    const body = { url };
    if (depth !== void 0) body.depth = depth;
    if (maxPages !== void 0) body.max_pages = maxPages;
    if (renderMode !== void 0) body.render_mode = renderMode;
    if (includeSubdomains !== void 0) body.include_subdomains = includeSubdomains;
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/crawl`,
      {
        method: "POST",
        headers: { ...JSON_HEADERS, ...this.authHeaders() },
        body: JSON.stringify(body),
        signal
      },
      { stream: true }
    );
    yield* this.parseSSE(res);
  }
  async config() {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/config`);
    return await res.json();
  }
  async configDefaults() {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/config/defaults`);
    return await res.json();
  }
  async updateConfig(updates) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/config`, {
      method: "PATCH",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify(updates)
    });
    return await res.json();
  }
  async setEmbeddingModel(model) {
    return this.fetchResult(`${this.baseUrl}/api/models/embedding`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify({ model })
    });
  }
  async setRerankerModel(model) {
    return this.fetchResult(`${this.baseUrl}/api/models/reranker`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify({ model })
    });
  }
  async setVisionModel(model) {
    return this.fetchResult(`${this.baseUrl}/api/models/vision`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify({ model })
    });
  }
  /** Live per-GPU utilization + free memory, streamed as SSE until aborted. */
  async *gpuStatsStream(signal) {
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/gpus/stream`,
      { headers: this.authHeaders() },
      { stream: true, signal }
    );
    yield* this.parseSSE(res);
  }
  /** The current effective placement (auto plan or active manual spec). */
  async placement() {
    return this.fetchResult(`${this.baseUrl}/api/placement`, { headers: this.authHeaders() });
  }
  /** Dry-run a candidate spec (or auto when null); reports fit without persisting. */
  async placementPreview(spec) {
    return this.fetchResult(`${this.baseUrl}/api/placement/preview`, {
      method: "POST",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify({ spec })
    });
  }
  /** Apply a manual spec: persists it and rebuilds the fleet. Returns 409 when
   * the server has not enabled HTTP placement (older or shared deployments). */
  async applyPlacement(spec) {
    return this.fetchResult(`${this.baseUrl}/api/placement`, {
      method: "PUT",
      headers: { ...JSON_HEADERS, ...this.authHeaders() },
      body: JSON.stringify({ spec })
    });
  }
  /** Clear the manual spec, returning to auto placement (rebuilds the fleet). */
  async clearPlacement() {
    return this.fetchResult(`${this.baseUrl}/api/placement`, {
      method: "DELETE",
      headers: this.authHeaders()
    });
  }
  /** Which agent CLIs the server can see on the machine it runs on. */
  async getAgentConfigIndex() {
    return this.fetchResult(`${this.baseUrl}/api/agent-config`, {
      headers: this.authHeaders()
    });
  }
  /** One client's config document, built against this server's live URL and token. */
  async getAgentConfig(client) {
    return this.fetchResult(`${this.baseUrl}/api/agent-config/${encodeURIComponent(client)}`, {
      headers: this.authHeaders()
    });
  }
  async wikiList() {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki`, { headers: this.authHeaders() });
    return await res.json();
  }
  /**
   * The subjects the corpus names that have no page yet.
   *
   * Returns `[]` on 404 rather than throwing: the route arrived after the
   * plugin shipped, so an older server simply has no stubs to offer and the
   * browse list should render its written pages as before instead of failing.
   */
  async wikiStubs() {
    try {
      const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/stubs`, {
        headers: this.authHeaders()
      });
      return await res.json();
    } catch (e) {
      if (e instanceof Error && isHttpStatus(e, 404)) return [];
      throw e;
    }
  }
  /**
   * Write one indexed page. Costs a single LLM call and is GPU-heavy.
   *
   * Not a stream, but nothing like a normal request either: the server holds
   * the connection for the whole generation, which is minutes on a large
   * model. The default 15s timeout aborted every call before the page could
   * land, so this one names its own.
   */
  /**
   * Write one indexed page, streaming progress.
   *
   * The server holds this open for a whole model call, so it streams like the
   * wiki build rather than answering with a body: wiki_phase, heartbeats
   * while the GPU works, wiki_page, then done. The done event carries the
   * slug the read route accepts — the bare slug the caller sends is 404 there.
   */
  async *wikiGenerate(slug, signal) {
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/wiki/generate/${encodeURIComponent(slug)}`,
      { method: "POST", headers: this.authHeaders() },
      { stream: true, signal }
    );
    yield* this.parseSSE(res);
  }
  async wikiPage(slug) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/${encodeURIComponent(slug)}`, {
      headers: this.authHeaders()
    });
    return await res.json();
  }
  async wikiCitations(slug) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/${encodeURIComponent(slug)}/citations`, {
      headers: this.authHeaders()
    });
    return await res.json();
  }
  async wikiLint() {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/lint`, {
      method: "POST",
      headers: this.authHeaders()
    });
    return await res.json();
  }
  /**
   * Refresh the wiki across every ingested source, streaming progress.
   *
   * A build issues per-source LLM calls and embeddings and can run for a long
   * time, so the server streams `wiki_phase` / `wiki_page` events and closes
   * with a `done` event carrying a {@link WikiBuildResult}. Aborting the
   * signal stops the run at the next source boundary and releases the
   * server's build mutex.
   */
  async *wikiUpdate(signal) {
    const res = await this.fetchWithRetry(
      `${this.baseUrl}/api/wiki/update`,
      {
        method: "PATCH",
        headers: this.authHeaders()
      },
      { stream: true, signal }
    );
    yield* this.parseSSE(res);
  }
  /**
   * Fetch the rendered text of a source file (markdown / html / plaintext)
   * as JSON. Used by the preview modal when the file is not in the vault.
   */
  async getSource(source) {
    const params = new URLSearchParams({ source });
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/source?${params}`, {
      headers: this.authHeaders()
    });
    return await res.json();
  }
  /**
   * Fetch the raw bytes of a source file with its original Content-Type.
   * Returns the raw Response so callers can read `arrayBuffer()` or stream
   * it into an `<object>` tag (e.g. PDFs in the preview modal).
   */
  async getSourceRaw(source) {
    const params = new URLSearchParams({ source, raw: "1" });
    return this.fetchWithRetry(`${this.baseUrl}/api/source?${params}`, {
      headers: this.authHeaders()
    });
  }
  async wikiDrafts() {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/drafts`, { headers: this.authHeaders() });
    return await res.json();
  }
  async wikiDraftDiff(slug) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/drafts/diff/${encodeURIComponent(slug)}`, {
      headers: this.authHeaders()
    });
    return res.text();
  }
  async wikiDraftAccept(slug) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/drafts/accept/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: this.authHeaders()
    });
    return await res.json();
  }
  async wikiDraftReject(slug) {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/drafts/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: this.authHeaders()
    });
    return await res.json();
  }
  /**
   * Prune stale and orphaned wiki pages. The server walks the tree and the
   * store off its event loop and answers once with the whole report, so this
   * is a single request rather than a progress stream.
   */
  async wikiPrune() {
    const res = await this.fetchWithRetry(`${this.baseUrl}/api/wiki/prune`, {
      method: "POST",
      headers: this.authHeaders()
    });
    return await res.json();
  }
  async *parseSSE(response) {
    if (!response.body) {
      throw new Error("Response body is null");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = SSE_EVENT.MESSAGE;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = (line.startsWith("event: ") ? line.slice(7) : line.slice(6)).trim();
        } else if (line.startsWith("data:")) {
          const raw = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
          try {
            yield { event: currentEvent, data: JSON.parse(raw) };
          } catch {
            yield { event: currentEvent, data: raw };
          }
          currentEvent = SSE_EVENT.MESSAGE;
        }
      }
    }
  }
};

// src/binary-manager.ts
var import_obsidian2 = require("obsidian");
var import_child_process = require("child_process");
var import_https = require("https");
var import_fs = require("fs");
var import_path = require("path");
var import_crypto = require("crypto");
var import_util = require("util");

// src/utils.ts
var import_obsidian = require("obsidian");
function tagModalChrome(modal) {
  modal.modalEl.addClass("lilbee-modal-chrome");
}
function bindEscapeToClose(modal) {
  modal.scope.register([], "Escape", () => {
    modal.close();
    return false;
  });
  tagModalChrome(modal);
}
function closeSettings(app) {
  const setting = app.setting;
  if (typeof setting?.close === "function") setting.close();
}
function openPluginSettingsById(app, pluginId) {
  const setting = app.setting;
  if (typeof setting?.open !== "function" || typeof setting.openTabById !== "function") return;
  setting.open();
  setting.openTabById(pluginId);
}
function renderExternalLink(parent, label, url) {
  const link = parent.createEl("a", { cls: "lilbee-external-link", text: label });
  link.setAttribute("href", url);
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer");
  link.addEventListener("click", (e) => {
    e.preventDefault();
    window.open(url, "_blank");
  });
  return link;
}
function debounce(fn, ms) {
  let timer = null;
  return {
    run: (...args) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), ms);
    },
    cancel: () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    }
  };
}
var DEBOUNCE_MS = 300;
var RETRY_INTERVAL_MS = 5e3;
var NOTICE_DURATION_MS = 3e3;
var NOTICE_ERROR_DURATION_MS = 8e3;
var NOTICE_PERMANENT = 0;
var TIME_REFRESH_INTERVAL_MS = 3e4;
var HEALTH_PROBE_INTERVAL_MS = 3e4;
var HEALTH_FAILURE_STREAK_THRESHOLD = 2;
var SPINNER_MIN_DISPLAY_MS = 800;
var STREAM_IDLE_TIMEOUT_MS = 12e4;
var StreamIdleError = class extends Error {
  constructor(timeoutMs) {
    super(`stream idle for ${Math.round(timeoutMs / 1e3)}s`);
    this.name = "StreamIdleError";
  }
};
async function* withIdleTimeout(gen, timeoutMs, abort) {
  const iter = gen[Symbol.asyncIterator]();
  while (true) {
    let timer = null;
    const idle = new Promise((resolve2) => {
      timer = window.setTimeout(() => resolve2("idle"), timeoutMs);
    });
    const race = await Promise.race([iter.next(), idle]);
    if (timer !== null && typeof clearTimeout === "function") window.clearTimeout(timer);
    if (race === "idle") {
      abort();
      void iter.return?.(void 0);
      throw new StreamIdleError(timeoutMs);
    }
    const { done, value } = race;
    if (done) return;
    yield value;
  }
}
function formatAbbreviatedCount(count) {
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}K`;
  return String(count);
}
function ensureUrlScheme(url) {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}
function relativeTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1e3);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
function isVersionOlder(current, latest) {
  const runs = (v) => (v.match(/\d+/g) ?? []).map(Number);
  const a = runs(current);
  const b = runs(latest);
  for (let i2 = 0; i2 < Math.max(a.length, b.length); i2++) {
    const x2 = a[i2] ?? 0;
    const y = b[i2] ?? 0;
    if (x2 !== y) return x2 < y;
  }
  return false;
}
var SESSIONS_MIN_SERVER_VERSION = "0.6.90b420";
var PLACEMENT_MIN_SERVER_VERSION = "0.6.90b420";
function supportsSessions(version) {
  if (!version) return true;
  return !isVersionOlder(version, SESSIONS_MIN_SERVER_VERSION);
}
function supportsPlacement(version) {
  if (!version) return true;
  return !isVersionOlder(version, PLACEMENT_MIN_SERVER_VERSION);
}
function relativeTimeFromIso(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return relativeTime(t);
}
var BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${BYTE_UNITS[unit]}`;
}
function formatRate(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "";
  return `${formatBytes(bytesPerSecond)}/s`;
}
function formatDiskSize(bytes) {
  if (!bytes) return "0 B";
  const exp = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log10(bytes) / 3));
  const value = bytes / 10 ** (exp * 3);
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${BYTE_UNITS[exp]}`;
}
function sessionTokenInvalidMessage(serverMode) {
  return serverMode === SERVER_MODE.MANAGED ? MESSAGES.NOTICE_SESSION_TOKEN_INVALID_MANAGED : MESSAGES.NOTICE_SESSION_TOKEN_INVALID;
}
var STREAM_INTERRUPTED_MESSAGE = "network error";
function isStreamInterruptedError(err3) {
  return err3 instanceof TypeError && err3.message === STREAM_INTERRUPTED_MESSAGE;
}
function streamInterruptedMessage(serverMode) {
  return serverMode === SERVER_MODE.MANAGED ? MESSAGES.ERROR_STREAM_INTERRUPTED_MANAGED : MESSAGES.ERROR_STREAM_INTERRUPTED_EXTERNAL;
}
function errorMessage(err3, fallback, serverMode) {
  if (err3 instanceof SessionTokenError) {
    return sessionTokenInvalidMessage(serverMode ?? SERVER_MODE.EXTERNAL);
  }
  return err3 instanceof Error ? err3.message : fallback;
}
function noticeForResultError(err3, fallback, serverMode) {
  if (err3 instanceof SessionTokenError) {
    return sessionTokenInvalidMessage(serverMode ?? SERVER_MODE.EXTERNAL);
  }
  if (err3 instanceof Error) {
    const detail = extractServerErrorDetail(err3.message);
    if (detail !== null && isRoleMismatchDetail(detail)) {
      return detail;
    }
  }
  return fallback;
}
function extractSseErrorMessage(data, unknownFallback) {
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "message" in data) {
    const msg = data.message;
    if (typeof msg === "string") return msg;
  }
  return unknownFallback;
}
function extractServerErrorDetail(message) {
  const colonIdx = message.indexOf(":");
  if (colonIdx === -1) return null;
  const body = message.slice(colonIdx + 1).trim();
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "detail" in parsed) {
      const detail = parsed.detail;
      if (typeof detail === "string") return detail;
    }
  } catch {
    return null;
  }
  return null;
}
function isRoleMismatchDetail(detail) {
  return detail.includes("Set it via PUT /api/models/");
}
var MODEL_UNAVAILABLE_CODES = /* @__PURE__ */ new Set(["connection", "server", "not_found"]);
var LITELLM_MISSING_MARKER = "lilbee[litellm]";
function extractSseErrorCode(data) {
  if (data && typeof data === "object" && "code" in data) {
    const code = data.code;
    if (typeof code === "string") return code;
  }
  return null;
}
function isModelUnavailableError(code, message) {
  if (code !== null && MODEL_UNAVAILABLE_CODES.has(code)) return true;
  return message.includes(LITELLM_MISSING_MARKER);
}
function setDeterminateProgress(fill, percent) {
  fill.classList.remove("lilbee-progress-indeterminate");
  fill.style.width = `${percent}%`;
}
function percentOfBytes(received, total) {
  if (!total || total <= 0) return void 0;
  return Math.min(100, Math.round(received / total * 100));
}
function percentFromSse(data) {
  if (data.percent !== void 0) return data.percent;
  if (data.total && data.current !== void 0) {
    return Math.round(data.current / data.total * 100);
  }
  return void 0;
}
function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1e3);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}
function getSystemMemoryGB() {
  try {
    const os = require("os");
    return Math.round(os.totalmem() / (1024 * 1024 * 1024));
  } catch {
    return null;
  }
}
function getRelevantSystemMemoryGB(serverMode) {
  if (serverMode !== SERVER_MODE.MANAGED) return null;
  return getSystemMemoryGB();
}
var SERVER_UNREACHABLE_DEBOUNCE_MS = 5e3;
var lastServerUnreachableAt = 0;
function looksLikeConnectionRefused(err3) {
  const msg = err3.message.toLowerCase();
  return msg.includes("econnrefused") || msg.includes("failed to fetch") || msg.includes("fetch failed");
}
function noticeServerUnreachableIfApplicable(err3) {
  if (err3 instanceof ServerStartingError) return true;
  if (!(err3 instanceof Error)) return false;
  if (!looksLikeConnectionRefused(err3)) return false;
  const now = Date.now();
  if (now - lastServerUnreachableAt > SERVER_UNREACHABLE_DEBOUNCE_MS) {
    lastServerUnreachableAt = now;
    new import_obsidian.Notice(MESSAGES.NOTICE_SERVER_UNREACHABLE);
  }
  return true;
}
function configString(cfg, key) {
  const v = cfg[key];
  return typeof v === "string" ? v : "";
}

// src/binary-manager.ts
var execFileAsync = (0, import_util.promisify)(import_child_process.execFile);
var statfsAsync = (0, import_util.promisify)(import_fs.statfs);
var node = {
  spawn: import_child_process.spawn,
  execFile: execFileAsync,
  appendFileSync: import_fs.appendFileSync,
  existsSync: import_fs.existsSync,
  mkdirSync: import_fs.mkdirSync,
  chmodSync: import_fs.chmodSync,
  writeFileSync: import_fs.writeFileSync,
  readFileSync: import_fs.readFileSync,
  unlinkSync: import_fs.unlinkSync,
  copyFileSync: import_fs.copyFileSync,
  cpSync: import_fs.cpSync,
  statSync: import_fs.statSync,
  statfs: statfsAsync,
  renameSync: import_fs.renameSync,
  readdirSync: import_fs.readdirSync,
  rmSync: import_fs.rmSync,
  createWriteStream: import_fs.createWriteStream,
  join: import_path.join,
  basename: import_path.basename,
  resolve: import_path.resolve,
  dirname: import_path.dirname,
  createHash: import_crypto.createHash,
  processKill: process.kill.bind(process),
  requestUrl: import_obsidian2.requestUrl,
  // Node's https, not the renderer's fetch: GitHub's asset redirect fails CORS
  // in the renderer, which is why requestUrl was adopted for it originally.
  // Unlike requestUrl, this streams, so the download reports real progress.
  httpsGet: import_https.get,
  fetch: window.fetch.bind(window)
};
var GITHUB_REPO = "tobocop2/lilbee";
var LILBEE_GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`;
var RELEASE_LIST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
var RELEASE_HISTORY_LIMIT = 10;
var RELEASE_PAGE_SIZE = 100;
var RELEASE_PAGE_BUDGET = 3;
var RATE_LIMIT_STATUSES = /* @__PURE__ */ new Set([403, 429]);
var GITHUB_RATE_LIMITED = "GitHub's rate limit was reached; release checks reset within the hour.";
async function runNvidiaSmi() {
  try {
    const { stdout } = await node.execFile("nvidia-smi", []);
    return stdout;
  } catch {
    return null;
  }
}
function parseCudaCeiling(stdout) {
  const match = stdout.match(/CUDA Version:\s*(\d+)\.(\d+)/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number(match[2]);
}
function pickCudaTag(ceiling) {
  if (ceiling >= 1205) return SERVER_VARIANT.CU125;
  if (ceiling >= 1204) return SERVER_VARIANT.CU124;
  if (ceiling >= 1201) return SERVER_VARIANT.CU121;
  return null;
}
async function detectCudaTag() {
  if (process.platform === PLATFORM.DARWIN) return null;
  const stdout = await runNvidiaSmi();
  if (stdout === null) return null;
  const ceiling = parseCudaCeiling(stdout);
  if (ceiling === null) return null;
  return pickCudaTag(ceiling);
}
var KFD_DEVICE_PATH = "/dev/kfd";
var KFD_TOPOLOGY_NODES = "/sys/class/kfd/kfd/topology/nodes";
function gfxTargetName(version) {
  const major = Math.floor(version / 1e4);
  const minor = Math.floor(version % 1e4 / 100);
  const step = version % 100;
  return `gfx${major}${minor.toString(16)}${step.toString(16)}`;
}
function nodeGfxTarget(nodeName) {
  let text;
  try {
    text = node.readFileSync(node.join(KFD_TOPOLOGY_NODES, nodeName, "properties"), "utf-8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    const [name, value] = line.trim().split(/\s+/);
    if (name !== "gfx_target_version") continue;
    const version = Number(value);
    if (Number.isInteger(version) && version > 0) return gfxTargetName(version);
  }
  return null;
}
function detectAmdGfxTargets() {
  if (process.platform !== PLATFORM.LINUX) return [];
  if (!node.existsSync(KFD_DEVICE_PATH)) return [];
  let nodes;
  try {
    nodes = node.readdirSync(KFD_TOPOLOGY_NODES);
  } catch {
    return [];
  }
  const targets = /* @__PURE__ */ new Set();
  for (const nodeName of nodes) {
    const target2 = nodeGfxTarget(nodeName);
    if (target2) targets.add(target2);
  }
  return [...targets].sort();
}
async function detectHostGpu() {
  return { cuda: await detectCudaTag(), amdGfxTargets: detectAmdGfxTargets() };
}
function getPlatformAssetName(gpuTag) {
  const platform = process.platform;
  const arch = process.arch;
  const gpu = gpuTag ? `-${gpuTag}` : "";
  if (platform === PLATFORM.DARWIN && arch === ARCH.ARM64) return "lilbee-macos-arm64";
  if (platform === PLATFORM.LINUX && arch === ARCH.X64) return `lilbee-linux-x86_64${gpu}`;
  if (platform === PLATFORM.WIN32 && arch === ARCH.X64) return `lilbee-windows-x86_64${gpu}.exe`;
  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}
function assetNameForVariant(variant) {
  return getPlatformAssetName(variant === SERVER_VARIANT.DEFAULT ? null : variant);
}
var GFX_MANIFEST_SUFFIX = ".gfx.txt";
async function shippedGfxTargets(manifest) {
  if (!manifest) return null;
  try {
    const res = await node.requestUrl({ url: manifest.browser_download_url });
    if (res.status >= 400) return null;
    const targets = res.text.split("\n").map((line) => line.trim()).filter(Boolean);
    return targets.length > 0 ? new Set(targets) : null;
  } catch {
    return null;
  }
}
async function rocmServesHost(data, gfxTargets) {
  const manifestName = `${getPlatformAssetName(SERVER_VARIANT.ROCM)}${GFX_MANIFEST_SUFFIX}`;
  const shipped = await shippedGfxTargets(data.assets.find((a) => a.name === manifestName));
  return shipped !== null && gfxTargets.every((target2) => shipped.has(target2));
}
async function selectAsset(release, host) {
  const { data } = release;
  if (host.cuda) {
    const cudaAsset = data.assets.find((a) => a.name === getPlatformAssetName(host.cuda));
    if (cudaAsset) return { variant: host.cuda, asset: cudaAsset };
  }
  if (host.amdGfxTargets.length > 0) {
    const rocmAsset = data.assets.find((a) => a.name === getPlatformAssetName(SERVER_VARIANT.ROCM));
    if (rocmAsset && await rocmServesHost(data, host.amdGfxTargets)) {
      return { variant: SERVER_VARIANT.ROCM, asset: rocmAsset };
    }
  }
  return { variant: SERVER_VARIANT.DEFAULT, asset: release.fallback };
}
async function toReleaseInfo(release, host) {
  const { variant, asset } = await selectAsset(release, host);
  const { data } = release;
  return {
    tag: data.tag_name,
    assetUrl: asset.browser_download_url,
    variant,
    sizeBytes: asset.size,
    digest: asset.digest
  };
}
function isDevBuild(tag) {
  return /\.dev\d*$/i.test(tag);
}
function platformFallbackAsset(data) {
  let defaultName;
  try {
    defaultName = getPlatformAssetName(null);
  } catch {
    return null;
  }
  return data.assets.find((a) => a.name === defaultName) ?? null;
}
async function collectInstallableReleases(limit, includeDev) {
  const releases = [];
  let stableCount = 0;
  let devCount = 0;
  for (let page = 1; page <= RELEASE_PAGE_BUDGET; page++) {
    const res = await node.requestUrl({
      url: `${RELEASE_LIST_API}?per_page=${RELEASE_PAGE_SIZE}&page=${page}`,
      headers: { Accept: "application/vnd.github.v3+json" }
    });
    if (RATE_LIMIT_STATUSES.has(res.status)) throw new Error(GITHUB_RATE_LIMITED);
    if (res.status >= 400) throw new Error(`GitHub API responded ${res.status}`);
    const pageData = res.json;
    for (const data of pageData) {
      if (data.draft || data.prerelease) continue;
      const dev = isDevBuild(data.tag_name);
      if (dev && !includeDev) continue;
      if (dev ? devCount >= limit : stableCount >= limit) continue;
      const fallback = platformFallbackAsset(data);
      if (!fallback) continue;
      releases.push({ data, fallback });
      if (dev) devCount++;
      else stableCount++;
      if (stableCount >= limit && (!includeDev || devCount >= limit)) return releases;
    }
    if (pageData.length < RELEASE_PAGE_SIZE) break;
  }
  return releases;
}
async function fetchInstallableReleases(limit, includeDev) {
  const host = await detectHostGpu();
  const candidates = await collectInstallableReleases(limit, includeDev);
  return Promise.all(candidates.map((release) => toReleaseInfo(release, host)));
}
async function listReleases(includeDev, limit = RELEASE_HISTORY_LIMIT) {
  return fetchInstallableReleases(limit, includeDev);
}
async function getLatestRelease(includeDev) {
  const releases = await fetchInstallableReleases(1, includeDev);
  if (releases.length === 0) throw new Error("No installable lilbee release was found.");
  return releases[0];
}
function checkForUpdate(currentVersion, latestTag) {
  return currentVersion !== latestTag && latestTag !== "";
}
var DISK_SPACE_FACTOR = 1.1;
var MAX_REDIRECTS = 5;
var DOWNLOAD_IDLE_TIMEOUT_MS = 6e4;
var DOWNLOAD_STALLED = "The lilbee server download stalled. Check your connection and try again.";
var DOWNLOAD_CANCELED = "The lilbee server download was cancelled.";
var DownloadCanceledError = class extends Error {
  constructor() {
    super(DOWNLOAD_CANCELED);
    this.name = "DownloadCanceledError";
  }
};
var PART_SUFFIX = ".part";
var REDIRECT_STATUSES = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
function openStream(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve2, reject) => {
    const req = node.httpsGet(url, (res) => {
      req.setTimeout?.(0);
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (REDIRECT_STATUSES.has(status) && location) {
        res.resume();
        if (redirectsLeft === 0) {
          reject(new Error("Download failed: too many redirects"));
          return;
        }
        openStream(new URL(location, url).toString(), redirectsLeft - 1).then(resolve2, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`Download failed: ${status}`));
        return;
      }
      resolve2(res);
    });
    req.on("error", reject);
    req.setTimeout?.(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
      req.destroy(new Error(DOWNLOAD_STALLED));
    });
  });
}
function discard(path) {
  try {
    if (node.existsSync(path)) node.unlinkSync(path);
  } catch {
  }
}
function contentLength(res) {
  const raw = res.headers["content-length"];
  const parsed = Number(raw);
  return raw !== void 0 && Number.isFinite(parsed) ? parsed : null;
}
var BinaryManager = class {
  constructor(binDir) {
    this.binDir = binDir;
  }
  binDir;
  get binaryPath() {
    const name = process.platform === PLATFORM.WIN32 ? "lilbee.exe" : "lilbee";
    return (0, import_path.join)(this.binDir, name);
  }
  binaryExists() {
    return node.existsSync(this.binaryPath);
  }
  async ensureBinary(includeDev, onProgress, onQuarantineFailed, signal) {
    if (this.binaryExists()) return this.binaryPath;
    onProgress?.("Fetching latest release info...");
    const release = await getLatestRelease(includeDev);
    await this.download(
      release.assetUrl,
      release.sizeBytes,
      release.digest,
      onProgress,
      onQuarantineFailed,
      signal
    );
    return this.binaryPath;
  }
  /** Throw a user-facing error if the target filesystem can't hold the download. */
  async assertEnoughSpace(sizeBytes) {
    const required = Math.ceil(sizeBytes * DISK_SPACE_FACTOR);
    const stats = await node.statfs(this.binDir);
    const free = stats.bavail * stats.bsize;
    if (free < required) {
      throw new Error(
        `Not enough disk space for the lilbee server: need about ${formatDiskSize(required)} free, but only ${formatDiskSize(free)} is available. Free up some space and try again.`
      );
    }
  }
  /** Reject the download unless its SHA256 matches the digest GitHub reports for the asset. */
  assertDigest(actualHex, expectedDigest) {
    if (`sha256:${actualHex}` !== (expectedDigest ?? "").toLowerCase()) {
      throw new Error(
        "The downloaded lilbee server could not be verified against its checksum and was discarded. Please try again."
      );
    }
  }
  /** Stream *assetUrl* to *partPath*, hashing as it goes. Returns the SHA256 of what landed. */
  async streamToFile(assetUrl, partPath, fallbackTotal, onBytes, signal) {
    if (signal?.aborted) throw new DownloadCanceledError();
    const res = await openStream(assetUrl);
    const totalBytes = contentLength(res) ?? fallbackTotal;
    const hash = node.createHash("sha256");
    const file = node.createWriteStream(partPath);
    let receivedBytes = 0;
    return new Promise((resolve2, reject) => {
      let idleTimer;
      const stopClock = () => window.clearTimeout(idleTimer);
      const restartClock = () => {
        stopClock();
        idleTimer = window.setTimeout(() => fail(new Error(DOWNLOAD_STALLED)), DOWNLOAD_IDLE_TIMEOUT_MS);
      };
      const fail = (err3) => {
        stopClock();
        signal?.removeEventListener("abort", onAbort);
        res.destroy();
        file.destroy();
        reject(err3);
      };
      const onAbort = () => fail(new DownloadCanceledError());
      signal?.addEventListener("abort", onAbort, { once: true });
      res.on("data", (chunk) => {
        restartClock();
        hash.update(chunk);
        receivedBytes += chunk.length;
        onBytes({ receivedBytes, totalBytes });
      });
      res.on("error", fail);
      file.on("error", fail);
      res.pipe(file);
      file.on("finish", () => {
        stopClock();
        signal?.removeEventListener("abort", onAbort);
        resolve2(hash.digest("hex"));
      });
      restartClock();
    });
  }
  async download(assetUrl, sizeBytes, expectedDigest, onProgress, onQuarantineFailed, signal) {
    if (!node.existsSync(this.binDir)) {
      node.mkdirSync(this.binDir, { recursive: true });
    }
    await this.assertEnoughSpace(sizeBytes);
    onProgress?.("Downloading...", assetUrl);
    const dest = this.binaryPath;
    const partPath = `${dest}${PART_SUFFIX}`;
    let renamed = false;
    try {
      const actualHex = await this.streamToFile(
        assetUrl,
        partPath,
        sizeBytes > 0 ? sizeBytes : null,
        (progress) => onProgress?.("Downloading...", assetUrl, progress),
        signal
      );
      this.assertDigest(actualHex, expectedDigest);
      node.renameSync(partPath, dest);
      renamed = true;
      if (process.platform !== PLATFORM.WIN32) {
        node.chmodSync(dest, 493);
      }
    } catch (err3) {
      discard(partPath);
      if (renamed) discard(dest);
      throw err3;
    }
    if (process.platform === PLATFORM.DARWIN) {
      try {
        await node.execFile("xattr", ["-cr", dest]);
      } catch {
        onQuarantineFailed?.();
      }
    }
    onProgress?.("Download complete.", assetUrl);
  }
};

// src/dataset-io.ts
var import_obsidian3 = require("obsidian");

// src/utils/file-dialog.ts
var electronDialog = {
  /* v8 ignore start -- requires Electron runtime */
  showOpenDialog(opts) {
    const electron = require("electron");
    return electron.remote.dialog.showOpenDialog(opts);
  },
  showSaveDialog(opts) {
    const electron = require("electron");
    return electron.remote.dialog.showSaveDialog(opts);
  }
  /* v8 ignore stop */
};

// src/dataset-io.ts
var MAX_IMPORT_BYTES = 10 * 1024 * 1024;
var IMPORT_PROGRESS_PCT = 50;
var JSONL_EXTENSION = ".jsonl";
var MARKDOWN_EXTENSION = ".md";
var DEFAULT_EXPORT_NAME = "pages.parquet";
var DATASET_EXTENSIONS = ["parquet", "jsonl"];
function formatFromPath(path) {
  return path.toLowerCase().endsWith(JSONL_EXTENSION) ? DATASET_FORMAT.JSONL : DATASET_FORMAT.PARQUET;
}
function datasetStem(path) {
  const base = path.split("/").pop();
  return base.replace(/\.[^.]+$/, "") || "dataset";
}
function noteName(source) {
  const base = source.split("/").pop();
  return base.toLowerCase().endsWith(MARKDOWN_EXTENSION) ? base : base.replace(/\.[^.]+$/, "") + MARKDOWN_EXTENSION;
}
function datasetErrorMessage(err3) {
  if (!(err3 instanceof Error)) return String(err3);
  return extractServerErrorDetail(err3.message) ?? err3.message;
}
async function exportDatasetToDisk(api) {
  const result = await electronDialog.showSaveDialog({ defaultPath: DEFAULT_EXPORT_NAME });
  if (result.canceled || !result.filePath) return;
  const destination = result.filePath;
  try {
    const bytes = await api.exportDataset(formatFromPath(destination));
    node.writeFileSync(destination, Buffer.from(bytes));
    new import_obsidian3.Notice(MESSAGES.NOTICE_DATASET_EXPORTED(destination));
  } catch (err3) {
    new import_obsidian3.Notice(MESSAGES.ERROR_DATASET_EXPORT(datasetErrorMessage(err3)));
  }
}
async function importDatasetFromDisk(app, api, taskQueue) {
  const result = await electronDialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: MESSAGES.LABEL_DATASET_FILTER, extensions: DATASET_EXTENSIONS }]
  });
  if (result.canceled || result.filePaths.length === 0) return;
  const source = result.filePaths[0];
  let data;
  try {
    data = node.readFileSync(source);
  } catch (err3) {
    new import_obsidian3.Notice(MESSAGES.ERROR_DATASET_READ(datasetErrorMessage(err3)));
    return;
  }
  if (data.byteLength > MAX_IMPORT_BYTES) {
    new import_obsidian3.Notice(MESSAGES.ERROR_DATASET_TOO_LARGE);
    return;
  }
  await runImport(app, api, taskQueue, data, formatFromPath(source), datasetStem(source));
}
async function materializeSources(app, api, sources, folder) {
  if (app.vault.getAbstractFileByPath(folder) === null) await app.vault.createFolder(folder);
  for (const source of sources) {
    let content;
    try {
      content = await api.getSource(source);
    } catch {
      continue;
    }
    const path = `${folder}/${noteName(source)}`;
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing === null) await app.vault.create(path, content.markdown);
    else if (existing instanceof import_obsidian3.TFile) await app.vault.modify(existing, content.markdown);
  }
}
async function runImport(app, api, taskQueue, data, format, folder) {
  const taskId = taskQueue.enqueue(MESSAGES.LABEL_DATASET_IMPORT_TASK, TASK_TYPE.IMPORT);
  if (taskId === null) {
    new import_obsidian3.Notice(MESSAGES.NOTICE_QUEUE_FULL);
    return;
  }
  taskQueue.update(taskId, IMPORT_PROGRESS_PCT, MESSAGES.STATUS_DATASET_IMPORTING);
  try {
    let summary = null;
    for await (const event of api.importDataset(data, format)) {
      if (event.event === SSE_EVENT.EMBED) {
        const detail = event.data.file ?? "";
        taskQueue.update(taskId, IMPORT_PROGRESS_PCT, MESSAGES.STATUS_DATASET_EMBEDDING(detail));
      } else if (event.event === SSE_EVENT.ERROR) {
        const message = extractSseErrorMessage(event.data, MESSAGES.ERROR_UNKNOWN);
        taskQueue.fail(taskId, message);
        new import_obsidian3.Notice(MESSAGES.ERROR_DATASET_IMPORT(message));
        return;
      } else if (event.event === SSE_EVENT.DONE) {
        summary = event.data;
      }
    }
    if (summary === null) {
      taskQueue.fail(taskId, MESSAGES.ERROR_UNKNOWN);
      new import_obsidian3.Notice(MESSAGES.ERROR_DATASET_IMPORT(MESSAGES.ERROR_UNKNOWN));
      return;
    }
    await materializeSources(app, api, summary.sources, folder);
    taskQueue.complete(taskId);
    new import_obsidian3.Notice(MESSAGES.NOTICE_DATASET_IMPORTED(summary.sources.length, summary.pages, summary.chunks, folder));
  } catch (err3) {
    const message = datasetErrorMessage(err3);
    taskQueue.fail(taskId, message);
    new import_obsidian3.Notice(MESSAGES.ERROR_DATASET_IMPORT(message));
  }
}

// src/diagnostics-export.ts
var import_obsidian4 = require("obsidian");
var import_electron = require("electron");

// node_modules/fflate/esm/browser.js
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i2 = 0; i2 < 31; ++i2) {
    b[i2] = start += 1 << eb[i2 - 1];
  }
  var r = new i32(b[30]);
  for (var i2 = 1; i2 < 30; ++i2) {
    for (var j = b[i2]; j < b[i2 + 1]; ++j) {
      r[j] = j - b[i2] << 5 | i2;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = (function(cd, mb, r) {
  var s = cd.length;
  var i2 = 0;
  var l = new u16(mb);
  for (; i2 < s; ++i2) {
    if (cd[i2])
      ++l[cd[i2] - 1];
  }
  var le = new u16(mb);
  for (i2 = 1; i2 < mb; ++i2) {
    le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        var sv = i2 << 4 | cd[i2];
        var r_1 = mb - cd[i2];
        var v = le[cd[i2] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
      }
    }
  }
  return co;
});
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var flm = /* @__PURE__ */ hMap(flt, 9, 0);
var fdm = /* @__PURE__ */ hMap(fdt, 5, 0);
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  // determined by compression function
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err2 = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err2);
  if (!nt)
    throw e;
  return e;
};
var wbits = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
};
var wbits16 = function(d, p, v) {
  v <<= p & 7;
  var o = p / 8 | 0;
  d[o] |= v;
  d[o + 1] |= v >> 8;
  d[o + 2] |= v >> 16;
};
var hTree = function(d, mb) {
  var t = [];
  for (var i2 = 0; i2 < d.length; ++i2) {
    if (d[i2])
      t.push({ s: i2, f: d[i2] });
  }
  var s = t.length;
  var t2 = t.slice();
  if (!s)
    return { t: et, l: 0 };
  if (s == 1) {
    var v = new u8(t[0].s + 1);
    v[t[0].s] = 1;
    return { t: v, l: 1 };
  }
  t.sort(function(a, b) {
    return a.f - b.f;
  });
  t.push({ s: -1, f: 25001 });
  var l = t[0], r = t[1], i0 = 0, i1 = 1, i22 = 2;
  t[0] = { s: -1, f: l.f + r.f, l, r };
  while (i1 != s - 1) {
    l = t[t[i0].f < t[i22].f ? i0++ : i22++];
    r = t[i0 != i1 && t[i0].f < t[i22].f ? i0++ : i22++];
    t[i1++] = { s: -1, f: l.f + r.f, l, r };
  }
  var maxSym = t2[0].s;
  for (var i2 = 1; i2 < s; ++i2) {
    if (t2[i2].s > maxSym)
      maxSym = t2[i2].s;
  }
  var tr = new u16(maxSym + 1);
  var mbt = ln(t[i1 - 1], tr, 0);
  if (mbt > mb) {
    var i2 = 0, dt = 0;
    var lft = mbt - mb, cst = 1 << lft;
    t2.sort(function(a, b) {
      return tr[b.s] - tr[a.s] || a.f - b.f;
    });
    for (; i2 < s; ++i2) {
      var i2_1 = t2[i2].s;
      if (tr[i2_1] > mb) {
        dt += cst - (1 << mbt - tr[i2_1]);
        tr[i2_1] = mb;
      } else
        break;
    }
    dt >>= lft;
    while (dt > 0) {
      var i2_2 = t2[i2].s;
      if (tr[i2_2] < mb)
        dt -= 1 << mb - tr[i2_2]++ - 1;
      else
        ++i2;
    }
    for (; i2 >= 0 && dt; --i2) {
      var i2_3 = t2[i2].s;
      if (tr[i2_3] == mb) {
        --tr[i2_3];
        ++dt;
      }
    }
    mbt = mb;
  }
  return { t: new u8(tr), l: mbt };
};
var ln = function(n, l, d) {
  return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
};
var lc = function(c) {
  var s = c.length;
  while (s && !c[--s])
    ;
  var cl = new u16(++s);
  var cli = 0, cln = c[0], cls = 1;
  var w = function(v) {
    cl[cli++] = v;
  };
  for (var i2 = 1; i2 <= s; ++i2) {
    if (c[i2] == cln && i2 != s)
      ++cls;
    else {
      if (!cln && cls > 2) {
        for (; cls > 138; cls -= 138)
          w(32754);
        if (cls > 2) {
          w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
          cls = 0;
        }
      } else if (cls > 3) {
        w(cln), --cls;
        for (; cls > 6; cls -= 6)
          w(8304);
        if (cls > 2)
          w(cls - 3 << 5 | 8208), cls = 0;
      }
      while (cls--)
        w(cln);
      cls = 1;
      cln = c[i2];
    }
  }
  return { c: cl.subarray(0, cli), n: s };
};
var clen = function(cf, cl) {
  var l = 0;
  for (var i2 = 0; i2 < cl.length; ++i2)
    l += cf[i2] * cl[i2];
  return l;
};
var wfblk = function(out, pos, dat) {
  var s = dat.length;
  var o = shft(pos + 2);
  out[o] = s & 255;
  out[o + 1] = s >> 8;
  out[o + 2] = out[o] ^ 255;
  out[o + 3] = out[o + 1] ^ 255;
  for (var i2 = 0; i2 < s; ++i2)
    out[o + i2 + 4] = dat[i2];
  return (o + 4 + s) * 8;
};
var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
  wbits(out, p++, final);
  ++lf[256];
  var _a2 = hTree(lf, 15), dlt = _a2.t, mlb = _a2.l;
  var _b2 = hTree(df, 15), ddt = _b2.t, mdb = _b2.l;
  var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
  var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
  var lcfreq = new u16(19);
  for (var i2 = 0; i2 < lclt.length; ++i2)
    ++lcfreq[lclt[i2] & 31];
  for (var i2 = 0; i2 < lcdt.length; ++i2)
    ++lcfreq[lcdt[i2] & 31];
  var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
  var nlcc = 19;
  for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc)
    ;
  var flen = bl + 5 << 3;
  var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
  var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
  if (bs >= 0 && flen <= ftlen && flen <= dtlen)
    return wfblk(out, p, dat.subarray(bs, bs + bl));
  var lm, ll, dm, dl;
  wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
  if (dtlen < ftlen) {
    lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
    var llm = hMap(lct, mlcb, 0);
    wbits(out, p, nlc - 257);
    wbits(out, p + 5, ndc - 1);
    wbits(out, p + 10, nlcc - 4);
    p += 14;
    for (var i2 = 0; i2 < nlcc; ++i2)
      wbits(out, p + 3 * i2, lct[clim[i2]]);
    p += 3 * nlcc;
    var lcts = [lclt, lcdt];
    for (var it = 0; it < 2; ++it) {
      var clct = lcts[it];
      for (var i2 = 0; i2 < clct.length; ++i2) {
        var len = clct[i2] & 31;
        wbits(out, p, llm[len]), p += lct[len];
        if (len > 15)
          wbits(out, p, clct[i2] >> 5 & 127), p += clct[i2] >> 12;
      }
    }
  } else {
    lm = flm, ll = flt, dm = fdm, dl = fdt;
  }
  for (var i2 = 0; i2 < li; ++i2) {
    var sym = syms[i2];
    if (sym > 255) {
      var len = sym >> 18 & 31;
      wbits16(out, p, lm[len + 257]), p += ll[len + 257];
      if (len > 7)
        wbits(out, p, sym >> 23 & 31), p += fleb[len];
      var dst = sym & 31;
      wbits16(out, p, dm[dst]), p += dl[dst];
      if (dst > 3)
        wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
    } else {
      wbits16(out, p, lm[sym]), p += ll[sym];
    }
  }
  wbits16(out, p, lm[256]);
  return p + ll[256];
};
var deo = /* @__PURE__ */ new i32([65540, 131080, 131088, 131104, 262176, 1048704, 1048832, 2114560, 2117632]);
var et = /* @__PURE__ */ new u8(0);
var dflt = function(dat, lvl, plvl, pre, post, st) {
  var s = st.z || dat.length;
  var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
  var w = o.subarray(pre, o.length - post);
  var lst = st.l;
  var pos = (st.r || 0) & 7;
  if (lvl) {
    if (pos)
      w[0] = st.r >> 3;
    var opt = deo[lvl - 1];
    var n = opt >> 13, c = opt & 8191;
    var msk_1 = (1 << plvl) - 1;
    var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
    var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
    var hsh = function(i3) {
      return (dat[i3] ^ dat[i3 + 1] << bs1_1 ^ dat[i3 + 2] << bs2_1) & msk_1;
    };
    var syms = new i32(25e3);
    var lf = new u16(288), df = new u16(32);
    var lc_1 = 0, eb = 0, i2 = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
    for (; i2 + 2 < s; ++i2) {
      var hv = hsh(i2);
      var imod = i2 & 32767, pimod = head[hv];
      prev[imod] = pimod;
      head[hv] = imod;
      if (wi <= i2) {
        var rem = s - i2;
        if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
          pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i2 - bs, pos);
          li = lc_1 = eb = 0, bs = i2;
          for (var j = 0; j < 286; ++j)
            lf[j] = 0;
          for (var j = 0; j < 30; ++j)
            df[j] = 0;
        }
        var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
        if (rem > 2 && hv == hsh(i2 - dif)) {
          var maxn = Math.min(n, rem) - 1;
          var maxd = Math.min(32767, i2);
          var ml = Math.min(258, rem);
          while (dif <= maxd && --ch_1 && imod != pimod) {
            if (dat[i2 + l] == dat[i2 + l - dif]) {
              var nl = 0;
              for (; nl < ml && dat[i2 + nl] == dat[i2 + nl - dif]; ++nl)
                ;
              if (nl > l) {
                l = nl, d = dif;
                if (nl > maxn)
                  break;
                var mmd = Math.min(dif, nl - 2);
                var md = 0;
                for (var j = 0; j < mmd; ++j) {
                  var ti = i2 - dif + j & 32767;
                  var pti = prev[ti];
                  var cd = ti - pti & 32767;
                  if (cd > md)
                    md = cd, pimod = ti;
                }
              }
            }
            imod = pimod, pimod = prev[imod];
            dif += imod - pimod & 32767;
          }
        }
        if (d) {
          syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
          var lin = revfl[l] & 31, din = revfd[d] & 31;
          eb += fleb[lin] + fdeb[din];
          ++lf[257 + lin];
          ++df[din];
          wi = i2 + l;
          ++lc_1;
        } else {
          syms[li++] = dat[i2];
          ++lf[dat[i2]];
        }
      }
    }
    for (i2 = Math.max(i2, wi); i2 < s; ++i2) {
      syms[li++] = dat[i2];
      ++lf[dat[i2]];
    }
    pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i2 - bs, pos);
    if (!lst) {
      st.r = pos & 7 | w[pos / 8 | 0] << 3;
      pos -= 7;
      st.h = head, st.p = prev, st.i = i2, st.w = wi;
    }
  } else {
    for (var i2 = st.w || 0; i2 < s + lst; i2 += 65535) {
      var e = i2 + 65535;
      if (e >= s) {
        w[pos / 8 | 0] = lst;
        e = s;
      }
      pos = wfblk(w, pos + 1, dat.subarray(i2, e));
    }
    st.i = s;
  }
  return slc(o, 0, pre + shft(pos) + post);
};
var crct = /* @__PURE__ */ (function() {
  var t = new Int32Array(256);
  for (var i2 = 0; i2 < 256; ++i2) {
    var c = i2, k = 9;
    while (--k)
      c = (c & 1 && -306674912) ^ c >>> 1;
    t[i2] = c;
  }
  return t;
})();
var crc = function() {
  var c = -1;
  return {
    p: function(d) {
      var cr = c;
      for (var i2 = 0; i2 < d.length; ++i2)
        cr = crct[cr & 255 ^ d[i2]] ^ cr >>> 8;
      c = cr;
    },
    d: function() {
      return ~c;
    }
  };
};
var dopt = function(dat, opt, pre, post, st) {
  if (!st) {
    st = { l: 1 };
    if (opt.dictionary) {
      var dict = opt.dictionary.subarray(-32768);
      var newDat = new u8(dict.length + dat.length);
      newDat.set(dict);
      newDat.set(dat, dict.length);
      dat = newDat;
      st.w = dict.length;
    }
  }
  return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
};
var mrg = function(a, b) {
  var o = {};
  for (var k in a)
    o[k] = a[k];
  for (var k in b)
    o[k] = b[k];
  return o;
};
var wbytes = function(d, b, v) {
  for (; v; ++b)
    d[b] = v, v >>>= 8;
};
function deflateSync(data, opts) {
  return dopt(data, opts || {}, 0, 0);
}
var fltn = function(d, p, t, o) {
  for (var k in d) {
    var val = d[k], n = p + k, op = o;
    if (Array.isArray(val))
      op = mrg(o, val[1]), val = val[0];
    if (ArrayBuffer.isView(val))
      t[n] = [val, op];
    else {
      t[n += "/"] = [new u8(0), op];
      fltn(val, n, t, o);
    }
  }
};
var te = typeof TextEncoder != "undefined" && /* @__PURE__ */ new TextEncoder();
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}
function strToU8(str, latin1) {
  if (latin1) {
    var ar_1 = new u8(str.length);
    for (var i2 = 0; i2 < str.length; ++i2)
      ar_1[i2] = str.charCodeAt(i2);
    return ar_1;
  }
  if (te)
    return te.encode(str);
  var l = str.length;
  var ar = new u8(str.length + (str.length >> 1));
  var ai = 0;
  var w = function(v) {
    ar[ai++] = v;
  };
  for (var i2 = 0; i2 < l; ++i2) {
    if (ai + 5 > ar.length) {
      var n = new u8(ai + 8 + (l - i2 << 1));
      n.set(ar);
      ar = n;
    }
    var c = str.charCodeAt(i2);
    if (c < 128 || latin1)
      w(c);
    else if (c < 2048)
      w(192 | c >> 6), w(128 | c & 63);
    else if (c > 55295 && c < 57344)
      c = 65536 + (c & 1023 << 10) | str.charCodeAt(++i2) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
    else
      w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
  }
  return slc(ar, 0, ai);
}
var exfl = function(ex) {
  var le = 0;
  if (ex) {
    for (var k in ex) {
      var l = ex[k].length;
      if (l > 65535)
        err2(9);
      le += l + 4;
    }
  }
  return le;
};
var wzh = function(d, b, f, fn, u, c, ce, co) {
  var fl2 = fn.length, ex = f.extra, col = co && co.length;
  var exl = exfl(ex);
  wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
  if (ce != null)
    d[b++] = 20, d[b++] = f.os;
  d[b] = 20, b += 2;
  d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
  d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
  var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
  if (y < 0 || y > 119)
    err2(10);
  wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
  if (c != -1) {
    wbytes(d, b, f.crc);
    wbytes(d, b + 4, c < 0 ? -c - 2 : c);
    wbytes(d, b + 8, f.size);
  }
  wbytes(d, b + 12, fl2);
  wbytes(d, b + 14, exl), b += 16;
  if (ce != null) {
    wbytes(d, b, col);
    wbytes(d, b + 6, f.attrs);
    wbytes(d, b + 10, ce), b += 14;
  }
  d.set(fn, b);
  b += fl2;
  if (exl) {
    for (var k in ex) {
      var exf = ex[k], l = exf.length;
      wbytes(d, b, +k);
      wbytes(d, b + 2, l);
      d.set(exf, b + 4), b += 4 + l;
    }
  }
  if (col)
    d.set(co, b), b += col;
  return b;
};
var wzf = function(o, b, c, d, e) {
  wbytes(o, b, 101010256);
  wbytes(o, b + 8, c);
  wbytes(o, b + 10, c);
  wbytes(o, b + 12, d);
  wbytes(o, b + 16, e);
};
function zipSync(data, opts) {
  if (!opts)
    opts = {};
  var r = {};
  var files = [];
  fltn(data, "", r, opts);
  var o = 0;
  var tot = 0;
  for (var fn in r) {
    var _a2 = r[fn], file = _a2[0], p = _a2[1];
    var compression = p.level == 0 ? 0 : 8;
    var f = strToU8(fn), s = f.length;
    var com = p.comment, m = com && strToU8(com), ms = m && m.length;
    var exl = exfl(p.extra);
    if (s > 65535)
      err2(11);
    var d = compression ? deflateSync(file, p) : file, l = d.length;
    var c = crc();
    c.p(file);
    files.push(mrg(p, {
      size: file.length,
      crc: c.d(),
      c: d,
      f,
      m,
      u: s != fn.length || m && com.length != ms,
      o,
      compression
    }));
    o += 30 + s + exl + l;
    tot += 76 + 2 * (s + exl) + (ms || 0) + l;
  }
  var out = new u8(tot + 22), oe = o, cdl = tot - o;
  for (var i2 = 0; i2 < files.length; ++i2) {
    var f = files[i2];
    wzh(out, f.o, f, f.f, f.u, f.c.length);
    var badd = 30 + f.f.length + exfl(f.extra);
    out.set(f.c, f.o + badd);
    wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
  }
  wzf(out, o, files.length, cdl, oe);
  return out;
}

// src/utils/capped-log.ts
function appendCapped(path, chunk, maxBytes) {
  try {
    const dir = node.dirname(path);
    if (!node.existsSync(dir)) node.mkdirSync(dir, { recursive: true });
    if (node.existsSync(path) && node.statSync(path).size > maxBytes) {
      const content = node.readFileSync(path, "utf-8");
      node.writeFileSync(path, content.slice(-maxBytes));
    }
    node.appendFileSync(path, chunk);
  } catch {
  }
}

// src/error-journal.ts
var JOURNAL_MAX_ENTRIES = 200;
var PLUGIN_LOG_MAX_BYTES = 262144;
function formatJournalEntry(entry) {
  return `${entry.timestamp} [${entry.label}] ${entry.message}${entry.stack ? `
${entry.stack}` : ""}`;
}
var ErrorJournal = class {
  _entries = [];
  logPath = null;
  get entries() {
    return this._entries;
  }
  /** Point persistence at `<dataDir>/logs`. */
  setLogDir(dir) {
    this.logPath = node.join(dir, LOG_FILE.PLUGIN);
  }
  /** Record a server-lifecycle decision (start, stop, adopt, update, take-over). */
  lifecycle(message) {
    this.record("lifecycle", message);
  }
  record(label, message, stack) {
    const entry = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      label,
      message,
      stack: stack ?? null
    };
    this._entries.push(entry);
    if (this._entries.length > JOURNAL_MAX_ENTRIES) this._entries.shift();
    this.append(entry);
  }
  append(entry) {
    if (!this.logPath) return;
    appendCapped(this.logPath, `${formatJournalEntry(entry)}
`, PLUGIN_LOG_MAX_BYTES);
  }
};

// src/redact.ts
var REDACTED = "[redacted]";
var SECRET_LINE_PATTERNS = [
  /\b((?:\w+[_-])?(?:token|api[_-]?key|apikey|secret)\s*[:=]\s*["']?)(?:bearer\s+)?[^"'\s]+/gi,
  /\b(authorization\s*[:=]\s*["']?)(?:bearer\s+)?[^"'\s]+/gi
];
function redactSecrets(text) {
  let out = text;
  for (const pattern of SECRET_LINE_PATTERNS) {
    out = out.replace(pattern, `$1${REDACTED}`);
  }
  return out;
}
var SECRET_SETTING_KEYS = ["manualToken", "hfToken"];
function redactSettings(settings) {
  const copy = { ...settings };
  for (const key of SECRET_SETTING_KEYS) {
    if (typeof copy[key] === "string" && copy[key].length > 0) {
      copy[key] = REDACTED;
    }
  }
  return copy;
}

// src/diagnostics.ts
var LOG_TAIL_MAX_BYTES = 1048576;
var textEncoder = new TextEncoder();
var NOTE_NOT_FOUND = "not found";
var NOTE_TRUNCATED = "truncated to last 1 MiB";
var EXPECTED_LOGS = Object.values(LOG_FILE);
function readTailCapped(path) {
  const size = node.statSync(path).size;
  const text = node.readFileSync(path, "utf-8");
  if (size <= LOG_TAIL_MAX_BYTES) return { text, note: null };
  return { text: text.slice(-LOG_TAIL_MAX_BYTES), note: NOTE_TRUNCATED };
}
function collectFile(zipName, path) {
  try {
    if (!node.existsSync(path)) return { name: zipName, data: null, note: NOTE_NOT_FOUND };
    const { text, note } = readTailCapped(path);
    return { name: zipName, data: textEncoder.encode(redactSecrets(text)), note };
  } catch (e) {
    return { name: zipName, data: null, note: e instanceof Error ? e.message : String(e) };
  }
}
function listLogFiles(dataDir) {
  try {
    const dir = node.join(dataDir, LOGS_DIR);
    if (!node.existsSync(dir)) return [];
    return node.readdirSync(dir).filter((f) => String(f).endsWith(".log")).map(String);
  } catch {
    return [];
  }
}
function collectLogFiles(dataDir) {
  if (dataDir === null) return [];
  const found = listLogFiles(dataDir).map(
    (name) => collectFile(`${LOGS_DIR}/${name}`, node.join(dataDir, LOGS_DIR, name))
  );
  const haveNames = new Set(found.map((f) => f.name));
  for (const name of EXPECTED_LOGS) {
    const zipName = `${LOGS_DIR}/${name}`;
    if (!haveNames.has(zipName)) found.push({ name: zipName, data: null, note: NOTE_NOT_FOUND });
  }
  return found;
}
function journalText(ctx) {
  return ctx.journalEntries.map(formatJournalEntry).join("\n");
}
function renderSummary(ctx, files) {
  const lines = [
    MESSAGES.DIAG_REVIEW_WARNING,
    "",
    "# lilbee diagnostics",
    "",
    "## Environment",
    `- Plugin version: ${ctx.pluginVersion}`,
    `- Server version: ${ctx.serverVersion || "(unknown)"}`,
    `- Platform: ${process.platform} ${process.arch}`,
    `- Server state: ${ctx.serverState}`,
    `- Server URL: ${ctx.serverUrl || "(none)"}`,
    `- Data dir: ${ctx.dataDir ?? `(not local) ${MESSAGES.DIAG_REMOTE_SERVER_NOTE}`}`,
    `- Shared root: ${ctx.sharedRoot ?? "(none)"}`,
    "",
    "## Last server output",
    "```",
    redactSecrets(ctx.lastOutput) || "(empty)",
    "```",
    "",
    "## Collected files",
    ...files.map((f) => `- ${f.name}: ${f.data === null ? f.note ?? "missing" : f.note ?? "ok"}`),
    "",
    "## Plugin journal (errors and lifecycle events)",
    "```",
    redactSecrets(journalText(ctx)) || "(none)",
    "```"
  ];
  return lines.join("\n");
}
function collectDiagnostics(ctx) {
  const files = collectLogFiles(ctx.dataDir);
  if (ctx.dataDir !== null) {
    files.push(collectFile("config.toml", node.join(ctx.dataDir, "config.toml")));
  }
  files.push({
    name: "settings.json",
    data: textEncoder.encode(JSON.stringify(redactSettings(ctx.settings), null, 2)),
    note: null
  });
  files.push({ name: "journal.log", data: textEncoder.encode(redactSecrets(journalText(ctx))), note: null });
  const summaryMarkdown = renderSummary(ctx, files);
  return { files, summaryMarkdown };
}
function buildZip(bundle) {
  const entries = { "summary.md": textEncoder.encode(bundle.summaryMarkdown) };
  for (const file of bundle.files) {
    if (file.data !== null) entries[file.name] = file.data;
  }
  const zipped = zipSync(entries);
  return zipped;
}
function resolveOutputDir(fallbackDir) {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home) {
    const downloads = node.join(home, "Downloads");
    try {
      if (node.existsSync(downloads)) return downloads;
    } catch {
    }
  }
  return fallbackDir;
}

// src/diagnostics-export.ts
var NOTICE_DURATION_MS2 = 15e3;
function timestampSlug() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
}
async function exportDiagnostics(ctx) {
  const bundle = collectDiagnostics(ctx);
  const outDir = resolveOutputDir(ctx.dataDir ?? ".");
  const zipPath = node.join(outDir, `lilbee-diagnostics-${timestampSlug()}.zip`);
  let writtenPath = zipPath;
  try {
    node.writeFileSync(zipPath, buildZip(bundle));
    new import_obsidian4.Notice(MESSAGES.NOTICE_DIAGNOSTICS_EXPORTED(zipPath), NOTICE_DURATION_MS2);
  } catch {
    const summaryPath = node.join(outDir, `lilbee-diagnostics-${timestampSlug()}.summary.md`);
    try {
      node.writeFileSync(summaryPath, bundle.summaryMarkdown);
      writtenPath = summaryPath;
      new import_obsidian4.Notice(MESSAGES.NOTICE_DIAGNOSTICS_SUMMARY_ONLY(summaryPath), NOTICE_DURATION_MS2);
    } catch (e) {
      new import_obsidian4.Notice(MESSAGES.NOTICE_DIAGNOSTICS_FAILED(e instanceof Error ? e.message : String(e)));
      return;
    }
  }
  try {
    import_electron.shell.showItemInFolder(writtenPath);
  } catch {
  }
  try {
    await navigator.clipboard.writeText(bundle.summaryMarkdown);
  } catch {
  }
}

// src/server-manager.ts
function describeExit(code, signal) {
  if (signal) return `signal ${signal}`;
  if (code !== null) return `exit code ${code}`;
  return "unknown cause";
}
var SERVER_MANAGER_CONFIG = {
  HEALTH_POLL_INTERVAL_MS: 1e3,
  HEALTH_POLL_MAX_ATTEMPTS: 120,
  ADOPT_PROBE_TIMEOUT_MS: 2e3,
  ADOPTED_WATCH_INTERVAL_MS: 5e3,
  SHUTDOWN_REQUEST_TIMEOUT_MS: 3e3,
  // Must exceed the server's own worst-case fleet teardown (bounded ~10s
  // server-side) so a graceful stop is never cut short by an escalation.
  STOP_GRACE_MS: 12e3,
  KILL_GRACE_MS: 5e3,
  CRASH_RESTART_DELAY_MS: 3e3,
  MAX_CRASH_RESTARTS: 3,
  PORT_FILE_POLL_INTERVAL_MS: 500,
  PORT_FILE_MAX_ATTEMPTS: 240,
  SPAWN_CRASH_LOG_MAX_BYTES: 262144
};
var LOCK_REFUSAL_EXIT_CODE = 3;
var SCOPE_OWNER_FILE = "server.scope.owner.json";
var ScopeHeldError = class extends Error {
  constructor(serverOutput) {
    super(serverOutput || "another lilbee server owns the shared root");
    this.name = "ScopeHeldError";
  }
};
function readScopeOwner(sharedRoot) {
  const path = node.join(sharedRoot, SCOPE_OWNER_FILE);
  if (!node.existsSync(path)) return null;
  try {
    const parsed = JSON.parse(node.readFileSync(path, "utf-8"));
    if (typeof parsed.data_dir !== "string" || typeof parsed.pid !== "number") return null;
    return { dataDir: parsed.data_dir, pid: parsed.pid };
  } catch {
    return null;
  }
}
function readServerSession(dataDir) {
  try {
    const portRaw = node.readFileSync(node.join(dataDir, "data", "server.port"), "utf-8");
    const port = parseInt(portRaw.trim(), 10);
    if (isNaN(port) || port <= 0 || port > 65535) return null;
    const sessionRaw = node.readFileSync(node.join(dataDir, "data", "server.json"), "utf-8");
    const parsed = JSON.parse(sessionRaw);
    if (typeof parsed.token !== "string") return null;
    return { port, token: parsed.token };
  } catch {
    return null;
  }
}
async function requestServerShutdown(dataDir) {
  const session = readServerSession(dataDir);
  if (session === null) return false;
  try {
    const res = await node.fetch(`http://127.0.0.1:${session.port}/api/shutdown`, {
      method: "POST",
      headers: bearerHeaders(session.token),
      signal: AbortSignal.timeout(SERVER_MANAGER_CONFIG.SHUTDOWN_REQUEST_TIMEOUT_MS)
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function reportedVersion(res) {
  try {
    const body = await res.json();
    return typeof body.version === "string" ? body.version : "";
  } catch {
    return "";
  }
}
async function probeLilbeeHealth(session) {
  try {
    const res = await node.fetch(`http://127.0.0.1:${session.port}/api/health`, {
      headers: bearerHeaders(session.token),
      signal: AbortSignal.timeout(SERVER_MANAGER_CONFIG.ADOPT_PROBE_TIMEOUT_MS)
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (body.status !== "ok") return null;
    return { version: typeof body.version === "string" ? body.version : "" };
  } catch {
    return null;
  }
}
async function serverIsLive(dataDir) {
  const session = readServerSession(dataDir);
  if (session === null) return false;
  return await probeLilbeeHealth(session) !== null;
}
async function askServerToExit(dataDir, timeoutMs) {
  if (!await requestServerShutdown(dataDir)) return false;
  return awaitServerGone(dataDir, timeoutMs);
}
async function awaitServerGone(dataDir, timeoutMs) {
  const session = readServerSession(dataDir);
  if (session === null) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await node.fetch(`http://127.0.0.1:${session.port}/api/health`, {
        headers: bearerHeaders(session.token),
        signal: AbortSignal.timeout(SERVER_MANAGER_CONFIG.ADOPT_PROBE_TIMEOUT_MS)
      });
    } catch {
      return true;
    }
    await new Promise((r) => window.setTimeout(r, SERVER_MANAGER_CONFIG.PORT_FILE_POLL_INTERVAL_MS));
  }
  return false;
}
var DESIRED = {
  RUNNING: "running",
  STOPPED: "stopped"
};
var ServerManager = class _ServerManager {
  opts;
  child = null;
  /** Resolves when the current child's exit event fires; created at spawn. */
  childExit = null;
  desired = DESIRED.STOPPED;
  adopted = false;
  adoptedWatch = null;
  _state = SERVER_STATE.STOPPED;
  crashCount = 0;
  restartTimer = null;
  _actualPort = null;
  _spawnedVersion = "";
  _outputLines = [];
  /** Set when the child can no longer come up (spawn error, refusal, restarts exhausted); aborts discovery. */
  fatalStartError = null;
  /** Bumped per start(); a superseded attempt's discovery loop steps aside. */
  startGeneration = 0;
  static MAX_OUTPUT_LINES = 20;
  constructor(opts) {
    this.opts = opts;
  }
  get lastOutput() {
    return this._outputLines.join("\n");
  }
  get state() {
    return this._state;
  }
  get serverUrl() {
    if (this._actualPort === null) return "";
    return `http://127.0.0.1:${this._actualPort}`;
  }
  get dataDir() {
    return this.opts.dataDir;
  }
  /** Version the spawned child reported on its ready probe; empty when adopted or unknown. */
  get spawnedVersion() {
    return this._spawnedVersion;
  }
  get isAdopted() {
    return this.adopted;
  }
  get portFilePath() {
    return `${this.opts.dataDir}/data/server.port`;
  }
  get crashLogPath() {
    return `${this.opts.dataDir}/${LOGS_DIR}/${LOG_FILE.SPAWN_CRASH}`;
  }
  /** Persist the output ring buffer so a crash survives an Obsidian restart. */
  snapshotCrashOutput() {
    const header = `=== crash ${(/* @__PURE__ */ new Date()).toISOString()} ===
`;
    appendCapped(
      this.crashLogPath,
      `${header}${this.lastOutput}
`,
      SERVER_MANAGER_CONFIG.SPAWN_CRASH_LOG_MAX_BYTES
    );
  }
  setState(s) {
    this._state = s;
    this.opts.onStateChange?.(s);
  }
  journal(message) {
    this.opts.onJournal?.(message);
  }
  /** True when stop() has been requested; a method so TS narrowing can't fold it away. */
  stopRequested() {
    return this.desired === DESIRED.STOPPED;
  }
  /** Throws when waiting any longer is pointless: superseded, unrecoverable, or stopped. */
  assertStartupViable(generation) {
    if (this.startGeneration !== generation) throw new Error("Superseded by a newer start");
    if (this.fatalStartError) throw this.fatalStartError;
    if (this.stopRequested()) throw new Error("Server was stopped during startup");
  }
  async waitForPortFile(generation) {
    for (let i2 = 0; i2 < SERVER_MANAGER_CONFIG.PORT_FILE_MAX_ATTEMPTS; i2++) {
      this.assertStartupViable(generation);
      if (node.existsSync(this.portFilePath)) {
        const content = node.readFileSync(this.portFilePath, "utf-8").trim();
        const port = parseInt(content, 10);
        if (!isNaN(port) && port > 0 && port <= 65535) {
          this._actualPort = port;
          return;
        }
      }
      await new Promise((r) => window.setTimeout(r, SERVER_MANAGER_CONFIG.PORT_FILE_POLL_INTERVAL_MS));
    }
    throw new Error("Port file not found within timeout");
  }
  buildSpawnEnv() {
    const env = {
      ...process.env,
      // Force UTF-8 locale/stdio: GUI-spawned children inherit no locale,
      // so the server defaults to ASCII and crashes crawling non-ASCII output.
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      LILBEE_CORS_ORIGINS: "app://obsidian.md",
      LILBEE_PARENT_PID: String(process.pid),
      LILBEE_MODELS_DIR: this.opts.modelsDir,
      LILBEE_EXCLUSIVE_SCOPE: this.opts.sharedRoot
    };
    if (this.opts.ragSystemPrompt) {
      env.LILBEE_RAG_SYSTEM_PROMPT = this.opts.ragSystemPrompt;
    }
    if (this.opts.generalSystemPrompt) {
      env.LILBEE_GENERAL_SYSTEM_PROMPT = this.opts.generalSystemPrompt;
    }
    return env;
  }
  pushOutputLine(line) {
    this._outputLines.push(line);
    if (this._outputLines.length > _ServerManager.MAX_OUTPUT_LINES) {
      this._outputLines.shift();
    }
  }
  attachOutputCapture(child) {
    this.attachStreamCapture(child.stdout);
    this.attachStreamCapture(child.stderr);
  }
  attachStreamCapture(stream) {
    if (!stream) return;
    let partial = "";
    stream.on("data", (chunk) => {
      partial += chunk.toString();
      const lines = partial.split("\n");
      partial = lines.pop();
      for (const line of lines) {
        if (line.length > 0) this.pushOutputLine(line);
      }
    });
  }
  attachLifecycleHandlers(child) {
    child.on("exit", (code, signal) => {
      if (child !== this.child) return;
      this.child = null;
      if (this.desired === DESIRED.STOPPED) return;
      if (code === LOCK_REFUSAL_EXIT_CODE) {
        this.journal(`spawned server pid ${child.pid} refused to start: another server owns the shared root`);
        this.fatalStartError = new ScopeHeldError(this.lastOutput);
        this.setState(SERVER_STATE.ERROR);
        return;
      }
      this.pushOutputLine(`server exited (${describeExit(code, signal)})`);
      this.journal(`server pid ${child.pid} exited (${describeExit(code, signal)})`);
      this.snapshotCrashOutput();
      this.scheduleCrashRestart();
    });
    child.on("error", (err3) => {
      if (child !== this.child) return;
      this.child = null;
      if (this.desired === DESIRED.STOPPED) return;
      const line = `failed to launch server: ${err3.message}`;
      this.journal(line);
      this.pushOutputLine(line);
      this.snapshotCrashOutput();
      this.fatalStartError = new Error(`Failed to launch server: ${err3.message}`);
      this.setState(SERVER_STATE.ERROR);
    });
  }
  scheduleCrashRestart() {
    if (this.crashCount < SERVER_MANAGER_CONFIG.MAX_CRASH_RESTARTS) {
      this.crashCount++;
      this.journal(
        `restarting in ${SERVER_MANAGER_CONFIG.CRASH_RESTART_DELAY_MS}ms (attempt ${this.crashCount}/${SERVER_MANAGER_CONFIG.MAX_CRASH_RESTARTS})`
      );
      this.setState(SERVER_STATE.ERROR);
      this.restartTimer = window.setTimeout(() => {
        this.restartTimer = null;
        if (this.desired === DESIRED.RUNNING) void this.startForRestart();
      }, SERVER_MANAGER_CONFIG.CRASH_RESTART_DELAY_MS);
      return;
    }
    this.journal(`server did not stay up after ${SERVER_MANAGER_CONFIG.MAX_CRASH_RESTARTS} restarts; giving up`);
    this.fatalStartError = new Error(
      `Server kept exiting and did not come back after ${SERVER_MANAGER_CONFIG.MAX_CRASH_RESTARTS} restarts`
    );
    this.setState(SERVER_STATE.ERROR);
    this.opts.onRestartsExhausted?.(this.lastOutput);
  }
  /** Crash-loop restart: failures already surface via state + onRestartsExhausted, so don't rethrow. */
  async startForRestart() {
    try {
      await this.start();
    } catch {
    }
  }
  spawnChild() {
    const args = ["serve", "--host", "127.0.0.1", "--data-dir", this.opts.dataDir];
    const child = node.spawn(this.opts.binaryPath, args, {
      env: this.buildSpawnEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      // POSIX: own process group so stop() can signal the server *and* its
      // worker forks as a unit. Windows uses taskkill /t for the tree.
      detached: process.platform !== PLATFORM.WIN32
    });
    this.childExit = new Promise((resolve2) => child.once("exit", () => resolve2()));
    this.attachOutputCapture(child);
    this.attachLifecycleHandlers(child);
    return child;
  }
  async start() {
    if (this.child || this.adopted) return;
    const generation = ++this.startGeneration;
    this.desired = DESIRED.RUNNING;
    this._actualPort = null;
    this._spawnedVersion = "";
    this.fatalStartError = null;
    this.setState(SERVER_STATE.STARTING);
    this._outputLines = [];
    if (await this.tryAdopt()) {
      this.crashCount = 0;
      this.setState(SERVER_STATE.READY);
      return;
    }
    this.cleanupPortFile();
    this.child = this.spawnChild();
    this.journal(`spawned server pid ${this.child.pid}`);
    try {
      await this.waitForPortFile(generation);
      await this.waitForReady(generation);
      this.crashCount = 0;
      this.setState(SERVER_STATE.READY);
    } catch (err3) {
      if (this.startGeneration !== generation) return;
      if (this.stopRequested()) return;
      if (this.child) await this.stop();
      this.setState(SERVER_STATE.ERROR);
      throw err3;
    }
  }
  async tryAdopt() {
    const session = readServerSession(this.opts.dataDir);
    if (session === null) return false;
    const health = await probeLilbeeHealth(session);
    if (health === null) return false;
    if (this.versionDiffers(health.version) && await this.replaceMismatched(health.version)) return false;
    this._actualPort = session.port;
    this.adopted = true;
    this.watchAdopted();
    this.journal(`adopted running server on port ${session.port}`);
    return true;
  }
  /** True when running and installed versions differ; "v"-prefixed and bare forms compare equal, unknown never differs. */
  versionDiffers(running) {
    const installed = this.opts.installedVersion.replace(/^v/, "");
    const current = running.replace(/^v/, "");
    return installed !== "" && current !== "" && installed !== current;
  }
  /** Ask a version-mismatched server to exit; false when it will not go (the caller then adopts it anyway). */
  async replaceMismatched(running) {
    this.journal(
      `running server version ${running} differs from installed ${this.opts.installedVersion}; asking it to exit`
    );
    if (await askServerToExit(this.opts.dataDir, SERVER_MANAGER_CONFIG.STOP_GRACE_MS)) return true;
    this.journal("outdated server did not stop when asked; adopting it anyway");
    return false;
  }
  /** Health-poll an adopted server; there is no child process to emit exit events. */
  watchAdopted() {
    this.adoptedWatch = window.setInterval(() => {
      void this.checkAdopted();
    }, SERVER_MANAGER_CONFIG.ADOPTED_WATCH_INTERVAL_MS);
  }
  stopAdoptedWatch() {
    if (this.adoptedWatch !== null) {
      window.clearInterval(this.adoptedWatch);
      this.adoptedWatch = null;
    }
  }
  async checkAdopted() {
    if (!this.adopted || this._actualPort === null) return;
    const session = readServerSession(this.opts.dataDir);
    const live = session !== null && await probeLilbeeHealth({ port: this._actualPort, token: session.token }) !== null;
    if (live) return;
    if (!this.adopted || this.desired === DESIRED.STOPPED) return;
    this.stopAdoptedWatch();
    this.adopted = false;
    this._actualPort = null;
    const line = "adopted server became unreachable";
    this.journal(line);
    this.pushOutputLine(line);
    this.snapshotCrashOutput();
    this.scheduleCrashRestart();
  }
  async waitForReady(generation) {
    for (let i2 = 0; i2 < SERVER_MANAGER_CONFIG.HEALTH_POLL_MAX_ATTEMPTS; i2++) {
      this.assertStartupViable(generation);
      const url = this.serverUrl;
      if (url) {
        try {
          const session = readServerSession(this.opts.dataDir);
          const res = await node.fetch(
            `${url}/api/health`,
            session === null ? void 0 : { headers: bearerHeaders(session.token) }
          );
          if (res.ok) {
            this._spawnedVersion = await reportedVersion(res);
            return;
          }
        } catch {
        }
      }
      await new Promise((r) => window.setTimeout(r, SERVER_MANAGER_CONFIG.HEALTH_POLL_INTERVAL_MS));
    }
    throw new Error("Server did not become ready within timeout");
  }
  /**
   * Signal the child's whole process group (server + worker forks). The child
   * leads its own group because it was spawned detached; fall back to the bare
   * child if the group send fails (e.g. it already exited).
   */
  signalGroup(child, signal) {
    if (child.pid) {
      try {
        node.processKill(-child.pid, signal);
        return;
      } catch {
      }
    }
    child.kill(signal);
  }
  cleanupPortFile() {
    if (!node.existsSync(this.portFilePath)) return;
    try {
      node.unlinkSync(this.portFilePath);
    } catch {
    }
  }
  /** Resolves true when the child's exit fires within *ms*; false on timeout. */
  async exitedWithin(ms) {
    if (this.childExit === null) return true;
    return Promise.race([
      this.childExit.then(() => true),
      new Promise((resolve2) => window.setTimeout(() => resolve2(false), ms))
    ]);
  }
  /**
   * Stop the server and return only once its process is observably gone.
   *
   * Escalation: ask over the API, then SIGTERM the group, then SIGKILL it —
   * and await the exit event at the end regardless, so no exit can land
   * after stop() returns and be mistaken for a crash.
   */
  async stop() {
    this.desired = DESIRED.STOPPED;
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.adopted) {
      this.stopAdoptedWatch();
      await this.stopAdopted();
      this.adopted = false;
      this._actualPort = null;
      this.setState(SERVER_STATE.STOPPED);
      return;
    }
    const child = this.child;
    if (!child) {
      this.setState(SERVER_STATE.STOPPED);
      return;
    }
    await this.terminateChild(child);
    this.child = null;
    this.childExit = null;
    this._actualPort = null;
    this.setState(SERVER_STATE.STOPPED);
    this.cleanupPortFile();
  }
  /** Ask the child to exit, escalate on timeout, and await the observed exit. */
  async terminateChild(child) {
    const stopStartedAt = Date.now();
    const accepted = await requestServerShutdown(this.opts.dataDir);
    this.journal(`stopping server pid ${child.pid}: shutdown request ${accepted ? "accepted" : "not accepted"}`);
    if (!await this.exitedWithin(SERVER_MANAGER_CONFIG.STOP_GRACE_MS)) {
      if (process.platform === PLATFORM.WIN32) {
        this.journal(`sent taskkill /f /t to pid ${child.pid}`);
        try {
          await node.execFile("taskkill", ["/pid", String(child.pid), "/f", "/t"]);
        } catch (err3) {
          this.opts.onShutdownFailure?.(err3 instanceof Error ? err3 : new Error(String(err3)));
        }
      } else {
        this.journal(`sent SIGTERM to pid ${child.pid} group`);
        this.signalGroup(child, "SIGTERM");
        if (!await this.exitedWithin(SERVER_MANAGER_CONFIG.KILL_GRACE_MS)) {
          this.journal(`sent SIGKILL to pid ${child.pid} group`);
          this.signalGroup(child, "SIGKILL");
        }
      }
      await this.childExit;
    }
    this.journal(`server pid ${child.pid} exit observed after ${Date.now() - stopStartedAt}ms`);
  }
  /** Ask an adopted server to exit; report when it will not go. */
  async stopAdopted() {
    const gone = await askServerToExit(this.opts.dataDir, SERVER_MANAGER_CONFIG.STOP_GRACE_MS);
    if (gone) {
      this.journal("adopted server stopped when asked");
      this.cleanupPortFile();
      return;
    }
    this.journal("adopted server did not stop when asked");
    this.opts.onShutdownFailure?.(new Error("the running server did not stop when asked"));
  }
  async restart() {
    await this.stop();
    this.crashCount = 0;
    await this.start();
  }
};

// src/session-token.ts
var MAX_WALK_UP_DEPTH = 32;
function getDefaultLilbeeDataRoot() {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return null;
  if (process.platform === PLATFORM.DARWIN) {
    return `${home}/Library/Application Support/lilbee`;
  }
  if (process.platform === PLATFORM.WIN32) {
    const local = process.env.LOCALAPPDATA;
    return local ? `${local}/lilbee` : `${home}/AppData/Local/lilbee`;
  }
  const xdg = process.env.XDG_DATA_HOME;
  return xdg ? `${xdg}/lilbee` : `${home}/.local/share/lilbee`;
}
function findLocalLilbeeRoot(startDir) {
  let current = startDir;
  for (let i2 = 0; i2 < MAX_WALK_UP_DEPTH; i2++) {
    const candidate = `${current}/.lilbee`;
    if (node.existsSync(candidate)) return candidate;
    const parent = current.replace(/[/\\][^/\\]+$/, "");
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}
function resolveExternalDataRoot(vaultPath) {
  const envOverride = process.env.LILBEE_DATA;
  if (envOverride) return envOverride;
  if (vaultPath) {
    const local = findLocalLilbeeRoot(vaultPath);
    if (local) return local;
  }
  return getDefaultLilbeeDataRoot();
}
function readSessionToken(dataRoot) {
  if (!dataRoot) return null;
  const tokenPath = `${dataRoot}/data/server.json`;
  try {
    if (!node.existsSync(tokenPath)) return null;
    const content = node.readFileSync(tokenPath, "utf-8");
    const parsed = JSON.parse(content);
    return typeof parsed.token === "string" ? parsed.token : null;
  } catch {
    return null;
  }
}

// src/vault-registry.ts
var VAULT_ID_BYTES = 6;
var FALLBACK_SHARED_ROOT = "/tmp/lilbee";
function resolveSharedRoot(setting) {
  if (setting && setting.length > 0) return setting;
  return getDefaultLilbeeDataRoot() ?? FALLBACK_SHARED_ROOT;
}
function computeVaultId(vaultPath) {
  const canonical = node.resolve(vaultPath);
  return node.createHash("sha256").update(canonical).digest("hex").slice(0, VAULT_ID_BYTES * 2);
}
function sharedBinDir(sharedRoot) {
  return node.join(sharedRoot, SHARED_PATH.BIN);
}
function sharedModelsDir(sharedRoot) {
  return node.join(sharedRoot, SHARED_PATH.MODELS);
}
function vaultsRootDir(sharedRoot) {
  return node.join(sharedRoot, SHARED_PATH.VAULTS);
}
function defaultDataDirFor(sharedRoot, vaultId) {
  return node.join(vaultsRootDir(sharedRoot), vaultId);
}
function configPath(sharedRoot) {
  return node.join(sharedRoot, SHARED_PATH.CONFIG);
}
function registryPath(sharedRoot) {
  return node.join(sharedRoot, SHARED_PATH.REGISTRY);
}
function ensureDir(path) {
  if (!node.existsSync(path)) node.mkdirSync(path, { recursive: true });
}
function writeJsonAtomic(path, value) {
  ensureDir(node.dirname(path));
  const tmp = `${path}.tmp`;
  node.writeFileSync(tmp, JSON.stringify(value, null, 2));
  node.renameSync(tmp, path);
}
function readJson(path) {
  if (!node.existsSync(path)) return null;
  try {
    return JSON.parse(node.readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}
var VaultRegistry = class {
  constructor(sharedRoot) {
    this.sharedRoot = sharedRoot;
  }
  sharedRoot;
  loadConfig() {
    const parsed = readJson(configPath(this.sharedRoot));
    return { ...DEFAULT_SHARED_CONFIG, ...parsed ?? {} };
  }
  saveConfig(config) {
    writeJsonAtomic(configPath(this.sharedRoot), config);
  }
  list() {
    return readJson(registryPath(this.sharedRoot)) ?? [];
  }
  get(id) {
    return this.list().find((e) => e.id === id) ?? null;
  }
  upsert(entry) {
    const entries = this.list().filter((e) => e.id !== entry.id);
    entries.push(entry);
    writeJsonAtomic(registryPath(this.sharedRoot), entries);
  }
  /** Return the registered data-dir or the default location for this id. */
  resolveDataDir(id) {
    return this.get(id)?.dataDir ?? defaultDataDirFor(this.sharedRoot, id);
  }
};

// src/storage-stats.ts
function dirSizeBytes(path) {
  if (!node.existsSync(path)) return 0;
  let total = 0;
  let entries;
  try {
    entries = node.readdirSync(path);
  } catch {
    return 0;
  }
  for (const name of entries) {
    const child = node.join(path, name);
    let stat;
    try {
      stat = node.statSync(child);
    } catch {
      continue;
    }
    total += stat.isDirectory() ? dirSizeBytes(child) : stat.size;
  }
  return total;
}
function reportForVault(sharedRoot, vaultDataDir) {
  const binBytes = dirSizeBytes(sharedBinDir(sharedRoot));
  const modelsBytes = dirSizeBytes(sharedModelsDir(sharedRoot));
  const vaultBytes = dirSizeBytes(vaultDataDir);
  const totalBytes = binBytes + modelsBytes + vaultBytes;
  return { sharedRoot, binBytes, modelsBytes, vaultBytes, vaultDataDir, totalBytes };
}

// src/server-uninstall.ts
function target(kind, path) {
  return { kind, path, bytes: dirSizeBytes(path) };
}
function planUninstall(sharedRoot, vaultDataDir) {
  const targets = [
    target(UNINSTALL_TARGET.BINARY, sharedBinDir(sharedRoot)),
    target(UNINSTALL_TARGET.MODELS, sharedModelsDir(sharedRoot)),
    target(UNINSTALL_TARGET.INDEX, vaultDataDir)
  ];
  return { targets, totalBytes: targets.reduce((sum, t) => sum + t.bytes, 0) };
}
function executeUninstall(plan) {
  for (const t of plan.targets) {
    node.rmSync(t.path, { recursive: true, force: true });
  }
}

// src/settings.ts
var import_obsidian13 = require("obsidian");

// src/components/pill.ts
var PILL_CLS = {
  INSTALLED: "lilbee-pill-installed",
  CONTEXT: "lilbee-pill-context"
};
function renderPill(container, text, cls) {
  return container.createSpan({
    text,
    cls: `lilbee-pill ${cls}`
  });
}

// src/utils/model-ref.ts
var PROVIDER_PREFIXES = ["ollama/", "lm_studio/", "openai/", "anthropic/", "gemini/", "cohere/"];
var STRIP_SUFFIXES = [/-GGUF$/i, /-Instruct$/i, /-Chat$/i, /-v\d+(\.\d+)*$/i, /-\d{4}$/];
var META_PREFIX = /^Meta-/;
function nativeModelRef(hfRepo, ggufFilename) {
  const f = ggufFilename ?? "";
  if (f && f.endsWith(".gguf") && !f.includes("*")) return `${hfRepo}/${f}`;
  return hfRepo;
}
function extractHfRepo(ref) {
  if (!ref.endsWith(".gguf")) return ref;
  const slash = ref.lastIndexOf("/");
  if (slash <= 0) return ref;
  return ref.slice(0, slash);
}
function matchModelOption(active, optionValues) {
  if (optionValues.includes(active)) return active;
  const repo = extractHfRepo(active);
  if (optionValues.includes(repo)) return repo;
  return active;
}
function cleanDisplayName(repo) {
  let name = repo.includes("/") ? repo.slice(repo.indexOf("/") + 1) : repo;
  name = name.replace(META_PREFIX, "");
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of STRIP_SUFFIXES) {
      const next = name.replace(suffix, "");
      if (next !== name) {
        name = next;
        changed = true;
      }
    }
  }
  return name.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}
function displayLabelForRef(ref) {
  if (!ref) return "";
  if (ref.endsWith(".gguf") && ref.includes("/")) {
    return cleanDisplayName(extractHfRepo(ref));
  }
  for (const prefix of PROVIDER_PREFIXES) {
    if (ref.startsWith(prefix)) return ref.slice(prefix.length);
  }
  if (ref.includes("/")) {
    return cleanDisplayName(ref);
  }
  return ref;
}

// src/utils/server-version.ts
function versionActionFor(tagsNewestFirst, installedTag, selectedTag) {
  const installedIdx = tagsNewestFirst.indexOf(installedTag);
  const selectedIdx = tagsNewestFirst.indexOf(selectedTag);
  if (installedIdx === -1 || selectedIdx === -1) return VERSION_ACTION.INSTALL;
  if (selectedIdx === installedIdx) return VERSION_ACTION.REINSTALL;
  return selectedIdx < installedIdx ? VERSION_ACTION.UPDATE : VERSION_ACTION.DOWNGRADE;
}
function versionButtonLabel(action, selectedTag) {
  switch (action) {
    case VERSION_ACTION.REINSTALL:
      return MESSAGES.BUTTON_REINSTALL;
    case VERSION_ACTION.UPDATE:
      return MESSAGES.BUTTON_UPDATE_TO(selectedTag);
    case VERSION_ACTION.DOWNGRADE:
      return MESSAGES.BUTTON_DOWNGRADE_TO(selectedTag);
    default:
      return MESSAGES.BUTTON_INSTALL_TAG(selectedTag);
  }
}
function versionDescription(action, installedTag, selectedTag, installedIsLatest) {
  if (!installedTag) return MESSAGES.DESC_SERVER_VERSION_UNKNOWN;
  switch (action) {
    case VERSION_ACTION.UPDATE:
      return MESSAGES.DESC_SERVER_VERSION_UPDATE(installedTag, selectedTag);
    case VERSION_ACTION.DOWNGRADE:
      return MESSAGES.DESC_SERVER_VERSION_DOWNGRADE(installedTag);
    case VERSION_ACTION.REINSTALL:
      return installedIsLatest ? MESSAGES.DESC_SERVER_VERSION_INSTALLED(installedTag) : MESSAGES.DESC_SERVER_VERSION_OUTDATED(installedTag);
    default:
      return MESSAGES.DESC_SERVER_VERSION_PLAIN(installedTag);
  }
}

// src/views/catalog-modal.ts
var import_obsidian9 = require("obsidian");

// src/views/confirm-modal.ts
var import_obsidian5 = require("obsidian");
var ConfirmModal = class extends import_obsidian5.Modal {
  message;
  _resolve = null;
  decided = false;
  result;
  constructor(app, message) {
    super(app);
    this.message = message;
    this.result = new Promise((resolve2) => {
      this._resolve = resolve2;
    });
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-confirm-modal");
    contentEl.createEl("p", { text: this.message });
    const actions = contentEl.createDiv({ cls: "lilbee-confirm-actions" });
    const continueBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CONTINUE, cls: "mod-cta" });
    continueBtn.addEventListener("click", () => this.decide(true));
    const cancelBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CANCEL });
    cancelBtn.addEventListener("click", () => this.decide(false));
  }
  onClose() {
    this.decide(false);
  }
  decide(confirmed) {
    if (this.decided) return;
    this.decided = true;
    if (this._resolve) {
      const resolve2 = this._resolve;
      this._resolve = null;
      resolve2(confirmed);
    }
    this.close();
  }
};

// src/views/confirm-pull-modal.ts
var import_obsidian6 = require("obsidian");
var ConfirmPullModal = class extends import_obsidian6.Modal {
  model;
  _resolve = null;
  decided = false;
  result;
  constructor(app, model) {
    super(app);
    this.model = model;
    this.result = new Promise((resolve2) => {
      this._resolve = resolve2;
    });
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-confirm-pull");
    contentEl.createEl("h2", { text: MESSAGES.TITLE_DOWNLOAD_MODEL });
    const info = contentEl.createDiv({ cls: "lilbee-confirm-pull-info" });
    info.createEl("p", { text: `${MESSAGES.LABEL_MODEL}: ${this.model.displayName}` });
    info.createEl("p", { text: `${MESSAGES.LABEL_SIZE}: ${this.model.sizeGb} GB` });
    info.createEl("p", { text: `${MESSAGES.LABEL_MIN_RAM}: ${this.model.minRamGb} GB` });
    const tooLarge = typeof this.model.systemMemGb === "number" && this.model.systemMemGb < this.model.minRamGb;
    if (tooLarge) {
      const warn = contentEl.createDiv({ cls: "lilbee-confirm-pull-warning" });
      warn.createEl("p", {
        text: MESSAGES.WARNING_MODEL_EXCEEDS_RAM(this.model.minRamGb, this.model.systemMemGb)
      });
    }
    const actions = contentEl.createDiv({ cls: "lilbee-confirm-pull-actions" });
    const pullBtn = actions.createEl("button", {
      text: tooLarge ? MESSAGES.BUTTON_PULL_ANYWAY : MESSAGES.BUTTON_PULL_MODEL,
      cls: "mod-cta"
    });
    pullBtn.addEventListener("click", () => this.decide(true));
    const cancelBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CANCEL });
    cancelBtn.addEventListener("click", () => this.decide(false));
  }
  onClose() {
    this.decide(false);
  }
  decide(confirmed) {
    if (this.decided) return;
    this.decided = true;
    if (this._resolve) {
      const resolve2 = this._resolve;
      this._resolve = null;
      resolve2(confirmed);
    }
    this.close();
  }
};

// src/components/model-card.ts
var import_obsidian7 = require("obsidian");
var FIT_RAIL_CLASS = {
  [HARDWARE_FIT.FITS]: "is-fits",
  [HARDWARE_FIT.TIGHT]: "is-tight",
  [HARDWARE_FIT.WONT_RUN]: "is-wont-run"
};
var FIT_LABEL = {
  [HARDWARE_FIT.FITS]: MESSAGES.LABEL_FIT_FITS,
  [HARDWARE_FIT.TIGHT]: MESSAGES.LABEL_FIT_TIGHT,
  [HARDWARE_FIT.WONT_RUN]: MESSAGES.LABEL_FIT_WONT_RUN
};
var TASK_TAG_CLS = {
  [MODEL_TASK.CHAT]: "is-chat",
  [MODEL_TASK.EMBEDDING]: "is-embed",
  [MODEL_TASK.VISION]: "is-vision",
  [MODEL_TASK.RERANK]: "is-rerank"
};
function renderModelCard(container, entry, options) {
  const card = container.createDiv({ cls: "lilbee-model-card" });
  card.dataset.repo = entry.hf_repo;
  if (options.isActive) card.addClass("is-selected");
  if (entry.fit && FIT_RAIL_CLASS[entry.fit]) card.addClass(FIT_RAIL_CLASS[entry.fit]);
  if (entry.compat === MODEL_COMPAT.UNSUPPORTED) card.addClass("is-unsupported");
  renderCardHead(card, entry, options);
  renderCardTags(card, entry);
  renderCardSpecs(card, entry);
  renderCardStatus(card, entry, options);
  if (options.showActions) {
    renderCardActions(card, entry, options);
  }
  if (options.onClick) {
    const handler = options.onClick;
    card.addEventListener("click", (e) => {
      if (e.target?.tagName === "BUTTON") return;
      handler(entry);
    });
  }
  return card;
}
function renderCardHead(card, entry, options) {
  const head = card.createDiv({ cls: "lilbee-model-card-head" });
  head.createDiv({ cls: "lilbee-model-card-name", text: entry.display_name });
  if (options.onInfo) {
    const onInfo = options.onInfo;
    const infoBtn = head.createEl("button", {
      cls: "lilbee-model-card-info",
      attr: {
        type: "button",
        "aria-label": MESSAGES.LABEL_MODEL_INFO_BTN,
        title: MESSAGES.LABEL_MODEL_INFO_BTN
      }
    });
    (0, import_obsidian7.setIcon)(infoBtn, "info");
    infoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onInfo(entry);
    });
  }
}
function renderCardTags(card, entry) {
  const tags = card.createDiv({ cls: "lilbee-model-card-tags" });
  const taskCls = TASK_TAG_CLS[entry.task] ?? "is-chat";
  tags.createSpan({ text: entry.task, cls: `lilbee-tag lilbee-tag-task ${taskCls}` });
  if (entry.featured) {
    tags.createSpan({ text: MESSAGES.LABEL_PICK, cls: "lilbee-tag lilbee-tag-featured" });
  }
  if (HOSTED_SOURCES.has(entry.source)) {
    tags.createSpan({ text: entry.provider ?? entry.source, cls: "lilbee-tag lilbee-tag-provider" });
  }
  renderCompatTag(tags, entry);
}
function renderCompatTag(tags, entry) {
  const architecture = entry.architecture ?? "";
  if (entry.compat === MODEL_COMPAT.UNSUPPORTED) {
    const tag = tags.createSpan({
      text: MESSAGES.LABEL_COMPAT_UNSUPPORTED,
      cls: "lilbee-tag lilbee-tag-compat is-unsupported"
    });
    tag.setAttribute("title", MESSAGES.TOOLTIP_COMPAT_UNSUPPORTED(architecture));
  }
}
function renderCardSpecs(card, entry) {
  const specs = card.createDiv({ cls: "lilbee-model-card-specs" });
  specs.createEl("strong", { text: `${entry.size_gb} GB` });
  appendSpecPart(specs, entry.quality_tier);
  appendSpecPart(specs, entry.param_count ? `${entry.param_count} params` : "");
}
function appendSpecPart(parent, text) {
  if (!text) return;
  parent.createSpan({ cls: "lilbee-model-card-specs-sep" });
  parent.createSpan({ text });
}
function renderCardStatus(card, entry, options) {
  const status = card.createDiv({ cls: "lilbee-model-card-status" });
  const tone = statusTone(entry, options);
  status.createSpan({ cls: `lilbee-model-card-status-dot ${tone.dotCls}` });
  const label = status.createSpan({
    text: tone.label,
    cls: `lilbee-model-card-status-label ${tone.labelCls}`
  });
  if (entry.installed) {
    label.setAttribute("title", MESSAGES.TOOLTIP_MODEL_INSTALLED_SHARED);
  }
  if (entry.fit && FIT_LABEL[entry.fit]) {
    status.createSpan({
      text: FIT_LABEL[entry.fit],
      cls: "lilbee-model-card-fit-text"
    });
  }
}
function statusTone(entry, options) {
  if (options.isActive) {
    return { dotCls: "is-active", labelCls: "is-active", label: MESSAGES.LABEL_ACTIVE };
  }
  if (entry.installed) {
    return { dotCls: "is-installed", labelCls: "is-installed", label: MESSAGES.LABEL_INSTALLED };
  }
  if (entry.downloads > 0) {
    return {
      dotCls: "is-muted",
      labelCls: "is-muted",
      label: MESSAGES.LABEL_DOWNLOADS_COUNT(formatAbbreviatedCount(entry.downloads))
    };
  }
  return { dotCls: "is-muted", labelCls: "is-muted", label: "" };
}
function renderCardActions(card, entry, options) {
  const actions = card.createDiv({ cls: "lilbee-model-card-actions" });
  if (options.isActive) {
    const btn = actions.createEl("button", {
      text: MESSAGES.LABEL_ACTIVE,
      cls: "lilbee-btn lilbee-btn-active",
      attr: { disabled: "true" }
    });
    if (options.onUse) {
      const handler = options.onUse;
      btn.addEventListener("click", () => handler(entry, btn));
    }
    return;
  }
  if (entry.installed) {
    const useBtn = actions.createEl("button", {
      text: MESSAGES.BUTTON_USE,
      cls: "lilbee-btn lilbee-btn-primary lilbee-catalog-use"
    });
    if (options.onUse) {
      const handler = options.onUse;
      useBtn.addEventListener("click", () => handler(entry, useBtn));
    }
    const removeBtn = actions.createEl("button", {
      text: MESSAGES.BUTTON_REMOVE,
      cls: "lilbee-btn lilbee-btn-danger lilbee-catalog-remove"
    });
    if (options.onRemove) {
      const handler = options.onRemove;
      removeBtn.addEventListener("click", () => handler(entry, removeBtn));
    }
  } else if (entry.compat === MODEL_COMPAT.UNSUPPORTED) {
    actions.createEl("button", {
      text: MESSAGES.BUTTON_PULL,
      cls: "lilbee-btn lilbee-catalog-pull is-gated",
      attr: { disabled: "true", title: MESSAGES.TOOLTIP_PULL_UNSUPPORTED }
    });
  } else {
    const pullBtn = actions.createEl("button", {
      text: MESSAGES.BUTTON_PULL,
      cls: "lilbee-btn lilbee-btn-primary lilbee-catalog-pull"
    });
    if (options.onPull) {
      const handler = options.onPull;
      pullBtn.addEventListener("click", () => handler(entry, pullBtn));
    }
  }
}

// src/components/fit-chip.ts
function renderFitChip(container, fit) {
  if (fit !== HARDWARE_FIT.FITS && fit !== HARDWARE_FIT.TIGHT && fit !== HARDWARE_FIT.WONT_RUN) return;
  container.createSpan({ text: fitLabel(fit), cls: `lilbee-fit-chip lilbee-fit-${fit}` });
}
function fitLabel(fit) {
  if (fit === HARDWARE_FIT.FITS) return MESSAGES.LABEL_FIT_FITS;
  if (fit === HARDWARE_FIT.TIGHT) return MESSAGES.LABEL_FIT_TIGHT;
  return MESSAGES.LABEL_FIT_WONT_RUN;
}

// src/components/model-detail.ts
var MAX_DESCRIPTION_CHARS = 200;
function renderModelDetail(entry, container) {
  container.empty();
  container.createEl("h3", { cls: "lilbee-detail-name", text: entry.display_name });
  renderFitChip(container, entry.fit);
  renderVariants(container, entry.size_variants ?? null);
  renderDescription(container, entry.description);
  renderInstallStatus(container, entry);
  renderDownloads(container, entry.downloads);
}
function renderVariants(container, variants) {
  if (!variants || variants.length === 0) return;
  const section = container.createDiv({ cls: "lilbee-detail-section" });
  section.createSpan({ cls: "lilbee-detail-section-label", text: MESSAGES.LABEL_DETAIL_VARIANTS });
  const strip = section.createDiv({ cls: "lilbee-detail-variants" });
  for (const variant of variants) {
    strip.createSpan({ cls: "lilbee-detail-variant", text: variant.size_label });
  }
}
function renderDescription(container, description) {
  if (!description) return;
  const trimmed = description.length > MAX_DESCRIPTION_CHARS ? `${description.slice(0, MAX_DESCRIPTION_CHARS)}\u2026` : description;
  const section = container.createDiv({ cls: "lilbee-detail-section" });
  section.createSpan({ cls: "lilbee-detail-section-label", text: MESSAGES.LABEL_DETAIL_DESCRIPTION });
  section.createEl("p", { cls: "lilbee-detail-description", text: trimmed });
}
function renderInstallStatus(container, entry) {
  const section = container.createDiv({ cls: "lilbee-detail-section" });
  section.createSpan({ cls: "lilbee-detail-section-label", text: MESSAGES.LABEL_DETAIL_INSTALL_STATUS });
  const statusText = entry.installed ? MESSAGES.LABEL_INSTALLED : MESSAGES.LABEL_NOT_INSTALLED.trim();
  section.createSpan({ cls: "lilbee-detail-install-status", text: statusText });
}
function renderDownloads(container, downloads) {
  if (downloads <= 0) return;
  const section = container.createDiv({ cls: "lilbee-detail-section" });
  section.createSpan({ cls: "lilbee-detail-section-label", text: MESSAGES.LABEL_DETAIL_DOWNLOADS });
  section.createSpan({ cls: "lilbee-detail-downloads-value", text: formatAbbreviatedCount(downloads) });
}

// src/views/model-info-modal.ts
var import_obsidian8 = require("obsidian");
var ModelInfoModal = class extends import_obsidian8.Modal {
  entry;
  constructor(app, _plugin, entry) {
    super(app);
    this.entry = entry;
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-model-info-modal");
    contentEl.createEl("h2", { text: MESSAGES.MODEL_INFO_TITLE });
    const detailHost = contentEl.createDiv({ cls: "lilbee-model-info-detail" });
    renderModelDetail(this.entry, detailHost);
    this.renderMoreInfo(contentEl);
    this.renderHfLink(contentEl);
  }
  renderMoreInfo(parent) {
    const section = parent.createDiv({ cls: "lilbee-model-info-section" });
    addRow(section, MESSAGES.MODEL_INFO_TASK, this.entry.task);
    if (this.entry.param_count) addRow(section, MESSAGES.MODEL_INFO_PARAMS, this.entry.param_count);
    const ctx = this.entry.context_window;
    if (typeof ctx === "number" && ctx > 0) addRow(section, MESSAGES.MODEL_INFO_CONTEXT, String(ctx));
    if (this.entry.min_ram_gb > 0) addRow(section, MESSAGES.MODEL_INFO_RAM, `${this.entry.min_ram_gb} GB`);
    const quant = this.entry.quantization;
    if (typeof quant === "string" && quant.length > 0) addRow(section, MESSAGES.MODEL_INFO_QUANT, quant);
    if (this.entry.downloads > 0) {
      addRow(section, MESSAGES.MODEL_INFO_DOWNLOADS, formatAbbreviatedCount(this.entry.downloads));
    }
  }
  renderHfLink(parent) {
    if (!this.entry.hf_repo) return;
    const linkRow = parent.createDiv({ cls: "lilbee-model-info-link-row" });
    const url = `https://huggingface.co/${this.entry.hf_repo}`;
    const link = linkRow.createEl("a", {
      cls: "lilbee-hf-link",
      text: MESSAGES.MODEL_INFO_HF_LINK_LABEL
    });
    link.setAttribute("href", url);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    link.addEventListener("click", (e) => {
      e.preventDefault();
      window.open(url, "_blank");
    });
  }
};
function addRow(parent, label, value) {
  const row = parent.createDiv({ cls: "lilbee-model-info-row" });
  row.createSpan({ cls: "lilbee-model-info-label", text: label });
  row.createSpan({ cls: "lilbee-model-info-value", text: value });
}

// src/views/catalog-helpers.ts
var DISCOVER_RAIL_LIMIT = 12;
var TASK_TO_TAB = {
  [MODEL_TASK.CHAT]: CATALOG_TAB.CHAT,
  [MODEL_TASK.EMBEDDING]: CATALOG_TAB.EMBED,
  [MODEL_TASK.VISION]: CATALOG_TAB.VISION,
  [MODEL_TASK.RERANK]: CATALOG_TAB.RERANK
};
var TAB_TO_TASK = {
  [CATALOG_TAB.CHAT]: MODEL_TASK.CHAT,
  [CATALOG_TAB.EMBED]: MODEL_TASK.EMBEDDING,
  [CATALOG_TAB.VISION]: MODEL_TASK.VISION,
  [CATALOG_TAB.RERANK]: MODEL_TASK.RERANK
};
var KEY_STATUS_PILL_CLASS = {
  READY: "lilbee-key-status-pill-ready",
  NEEDS_KEY: "lilbee-key-status-pill-needs-key"
};
function hostedRowsOnly(rows) {
  return rows.filter((row) => HOSTED_SOURCES.has(row.source));
}
function localRowsOnly(rows) {
  return rows.filter((row) => !HOSTED_SOURCES.has(row.source));
}
function isUsableHostedRow(row) {
  return HOSTED_SOURCES.has(row.source) && row.key_status !== KEY_STATUS.MISSING_KEY;
}
function hasReadyHostedRow(rows) {
  return rows.some(isUsableHostedRow);
}
function hostedSourceRank(source) {
  return source === CATALOG_SOURCE.FRONTIER ? 1 : 0;
}
function compareHostedRows(a, b) {
  const rankDiff = hostedSourceRank(a.source) - hostedSourceRank(b.source);
  if (rankDiff !== 0) return rankDiff;
  const providerDiff = (a.provider ?? "").localeCompare(b.provider ?? "");
  if (providerDiff !== 0) return providerDiff;
  return a.display_name.localeCompare(b.display_name);
}
function hostedOptions(rows) {
  return rows.filter(isUsableHostedRow).sort(compareHostedRows).map((e) => [e.hf_repo, `${e.display_name}${e.provider ? ` [${e.provider}]` : ""}`]);
}
function groupByProvider(rows) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const provider = row.provider ?? "";
    const existing = groups.get(provider);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(provider, [row]);
    }
  }
  return [...groups.entries()].sort(([aProvider, aRows], [bProvider, bRows]) => {
    const rankDiff = hostedSourceRank(aRows[0].source) - hostedSourceRank(bRows[0].source);
    if (rankDiff !== 0) return rankDiff;
    return aProvider.localeCompare(bProvider);
  });
}
function renderProviderPill(parent, provider) {
  return parent.createSpan({ cls: "lilbee-provider-pill", text: provider });
}
function renderKeyStatusPill(parent, status) {
  if (status === KEY_STATUS.READY) {
    return parent.createSpan({
      cls: `lilbee-key-status-pill ${KEY_STATUS_PILL_CLASS.READY}`,
      text: MESSAGES.PILL_KEY_READY
    });
  }
  return parent.createSpan({
    cls: `lilbee-key-status-pill ${KEY_STATUS_PILL_CLASS.NEEDS_KEY}`,
    text: MESSAGES.PILL_KEY_NEEDS_KEY
  });
}
function taskToTabId(task) {
  return TASK_TO_TAB[task];
}
function tabIdToTask(tab) {
  return TAB_TO_TASK[tab] ?? null;
}
var FOR_YOU_ROLE_ORDER = [MODEL_TASK.CHAT, MODEL_TASK.EMBEDDING, MODEL_TASK.VISION, MODEL_TASK.RERANK];
function forYouSortKey(entry) {
  return [entry.fit === HARDWARE_FIT.FITS ? 0 : 1, entry.display_name.toLowerCase()];
}
function forYouRail(entries) {
  const runnable = entries.filter(
    (e) => e.featured && e.compat === MODEL_COMPAT.SUPPORTED && e.fit != null && e.fit !== HARDWARE_FIT.WONT_RUN
  );
  const picks = [];
  for (const task of FOR_YOU_ROLE_ORDER) {
    const best = runnable.filter((e) => e.task === task).sort((a, b) => {
      const [aRank, aName] = forYouSortKey(a);
      const [bRank, bName] = forYouSortKey(b);
      return aRank !== bRank ? aRank - bRank : aName.localeCompare(bName);
    })[0];
    if (best) picks.push(best);
  }
  return picks;
}
function yourCollectionRail(entries) {
  return entries.filter((e) => e.installed).slice(0, DISCOVER_RAIL_LIMIT);
}
function freshRail(entries) {
  return entries.filter((e) => !e.featured).sort((a, b) => b.downloads - a.downloads).slice(0, DISCOVER_RAIL_LIMIT);
}
function deepLinkToApiKeySettings(app, provider) {
  const settingApi = app.setting;
  if (!settingApi) return;
  settingApi.open();
  settingApi.openTabById("lilbee");
  window.setTimeout(() => {
    if (typeof activeDocument === "undefined") return;
    const escaped = provider.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const target2 = activeDocument.querySelector(`[data-lilbee-api-key="${escaped}"]`);
    if (target2 instanceof HTMLElement) {
      target2.scrollIntoView({ behavior: "smooth", block: "center" });
      target2.focus();
    }
  }, 50);
}

// src/views/catalog-modal.ts
var PAGE_SIZE = 20;
var SCROLL_BOTTOM_THRESHOLD_PX = 200;
var DRAWER_BREAKPOINT_PX = 800;
var DRAWER_FOCUS_DEBOUNCE_MS = 30;
var SUB_TAB = {
  LOCAL: "local",
  HOSTED: "hosted"
};
var TASK_SECTION_LABEL = {
  [MODEL_TASK.CHAT]: MESSAGES.LABEL_SECTION_CHAT,
  [MODEL_TASK.VISION]: MESSAGES.LABEL_SECTION_VISION,
  [MODEL_TASK.EMBEDDING]: MESSAGES.LABEL_SECTION_EMBEDDING,
  [MODEL_TASK.RERANK]: MESSAGES.LABEL_SECTION_RERANK
};
var TAB_SPECS = [
  { id: CATALOG_TAB.DISCOVER, label: MESSAGES.TAB_DISCOVER },
  { id: CATALOG_TAB.CHAT, label: MESSAGES.TAB_CHAT_MODELS },
  { id: CATALOG_TAB.EMBED, label: MESSAGES.TAB_EMBED_MODELS },
  { id: CATALOG_TAB.VISION, label: MESSAGES.TAB_VISION_MODELS },
  { id: CATALOG_TAB.RERANK, label: MESSAGES.TAB_RERANK_MODELS },
  { id: CATALOG_TAB.LIBRARY, label: MESSAGES.TAB_LIBRARY }
];
var CatalogModal = class extends import_obsidian9.Modal {
  plugin;
  filterTask = "";
  filterSize = "";
  filterSort = FILTERS.SORT.FEATURED;
  filterSearch = "";
  offset = 0;
  hasMore = false;
  isFetching = false;
  entries = [];
  resultsEl = null;
  viewMode = CATALOG_VIEW_MODE.GRID;
  sortColumn = "";
  sortAscending = true;
  viewToggleBtn = null;
  debouncedSearch;
  cancelDebouncedSearch;
  currentTab = SUB_TAB.LOCAL;
  subTabBarEl = null;
  hostedTabBtn = null;
  activeTab;
  mainTabBarEl = null;
  bodyEl = null;
  drawerEl = null;
  drawerContentEl = null;
  drawerToggleBtn = null;
  // Drawer starts collapsed: the cards are too cramped at the default modal
  // width when the 320px drawer eats half the row. Users discover details via
  // the per-card 'i' info button (Model Info modal); the drawer toggle in
  // the modal header lets them switch to the passive-panel layout.
  drawerCollapsedByUser = true;
  focusedRepo = null;
  focusDebounceTimeout = null;
  /**
   * @param initialTaskFilter Pre-select a task tab when opening (e.g.
   * from the wizard's Vision step so users land on vision-only results).
   * Defaults to "" which shows all tasks.
   * @param initialTab Pre-select one of the top-level catalog tabs. When
   * omitted, the modal restores the user's last-used tab from settings.
   */
  constructor(app, plugin, initialTaskFilter = "", initialTab) {
    super(app);
    this.plugin = plugin;
    this.filterTask = initialTaskFilter;
    this.activeTab = initialTab ?? plugin.settings.lastCatalogTab ?? CATALOG_TAB.DISCOVER;
    if (initialTab === void 0 && initialTaskFilter !== "") {
      this.activeTab = taskToTabId(initialTaskFilter);
    }
    const searchDebounced = debounce(() => this.resetAndFetch(), DEBOUNCE_MS);
    this.debouncedSearch = searchDebounced.run;
    this.cancelDebouncedSearch = searchDebounced.cancel;
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-catalog-modal");
    contentEl.createEl("h2", { text: MESSAGES.TITLE_MODEL_CATALOG });
    this.renderMainTabBar(contentEl);
    this.renderSubTabBar(contentEl);
    this.renderFilterBar(contentEl);
    this.bodyEl = contentEl.createDiv({ cls: "lilbee-catalog-body lilbee-catalog-body-with-drawer" });
    this.resultsEl = this.bodyEl.createDiv({ cls: "lilbee-catalog-results lilbee-catalog-tab-content" });
    this.resultsEl.addEventListener("scroll", this.onScroll);
    this.renderDrawer(this.bodyEl);
    this.bodyEl.addEventListener("focusin", this.onCardFocus);
    this.bodyEl.addEventListener("pointerover", this.onCardFocus);
    contentEl.addEventListener("keydown", this.onKeyDown);
    this.applyDrawerVisibility();
    this.applyTabToFilter();
    this.resetAndFetch();
  }
  renderDrawer(parent) {
    this.drawerEl = parent.createDiv({ cls: "lilbee-catalog-drawer" });
    const header = this.drawerEl.createDiv({ cls: "lilbee-catalog-drawer-header" });
    this.drawerToggleBtn = header.createEl("button", {
      cls: "lilbee-catalog-drawer-toggle",
      text: MESSAGES.BUTTON_DRAWER_TOGGLE
    });
    this.drawerToggleBtn.addEventListener("click", () => this.toggleDrawer());
    this.drawerContentEl = this.drawerEl.createDiv({ cls: "lilbee-catalog-drawer-content" });
    this.drawerContentEl.createEl("p", {
      cls: "lilbee-catalog-drawer-empty",
      text: MESSAGES.LABEL_DRAWER_NO_SELECTION
    });
  }
  toggleDrawer() {
    this.drawerCollapsedByUser = !this.drawerCollapsedByUser;
    this.applyDrawerVisibility();
  }
  applyDrawerVisibility() {
    if (!this.drawerEl || !this.bodyEl) return;
    const narrow = typeof window !== "undefined" && window.innerWidth < DRAWER_BREAKPOINT_PX;
    const collapsed = narrow || this.drawerCollapsedByUser;
    this.drawerEl.toggleClass("lilbee-catalog-drawer-collapsed", collapsed);
    this.bodyEl.toggleClass("lilbee-catalog-body-with-drawer", !collapsed);
  }
  onCardFocus = (e) => {
    const card = findCardElement(e.target);
    if (!card) return;
    const repo = card.dataset.repo;
    if (!repo || repo === this.focusedRepo) return;
    if (this.focusDebounceTimeout !== null) window.clearTimeout(this.focusDebounceTimeout);
    this.focusDebounceTimeout = window.setTimeout(() => {
      this.focusedRepo = repo;
      this.updateDrawerForRepo(repo);
    }, DRAWER_FOCUS_DEBOUNCE_MS);
  };
  updateDrawerForRepo(repo) {
    if (!this.drawerContentEl) return;
    const entry = this.entries.find((e) => e.hf_repo === repo);
    if (!entry) return;
    renderModelDetail(entry, this.drawerContentEl);
  }
  focusedEntry() {
    if (this.focusedRepo === null) return null;
    return this.entries.find((e) => e.hf_repo === this.focusedRepo) ?? null;
  }
  renderMainTabBar(parent) {
    this.mainTabBarEl = parent.createDiv({ cls: "lilbee-catalog-tab-bar lilbee-catalog-main-tab-bar" });
    for (const spec of TAB_SPECS) {
      const btn = this.mainTabBarEl.createEl("button", { cls: "lilbee-catalog-tab" });
      btn.dataset.tabId = spec.id;
      btn.createSpan({ text: spec.label });
      btn.setAttribute("aria-selected", spec.id === this.activeTab ? "true" : "false");
      if (spec.id === this.activeTab) btn.addClass("lilbee-catalog-tab-active");
      btn.addEventListener("click", () => this.switchMainTab(spec.id));
    }
  }
  switchMainTab(tab) {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    if (this.mainTabBarEl) {
      for (const btn of Array.from(this.mainTabBarEl.children)) {
        const isActive = btn.dataset.tabId === tab;
        btn.toggleClass("lilbee-catalog-tab-active", isActive);
        btn.setAttribute("aria-selected", isActive ? "true" : "false");
      }
    }
    this.plugin.settings.lastCatalogTab = tab;
    void this.plugin.saveSettings();
    this.currentTab = SUB_TAB.LOCAL;
    this.applyTabToFilter();
    this.updateSubTabBarVisibility();
    this.updateViewToggleVisibility();
    this.resetAndFetch();
  }
  updateViewToggleVisibility() {
    if (!this.viewToggleBtn) return;
    const showToggle = this.activeTab !== CATALOG_TAB.DISCOVER;
    this.viewToggleBtn.style.display = showToggle ? "" : "none";
  }
  applyTabToFilter() {
    const task = tabIdToTask(this.activeTab);
    this.filterTask = task ?? "";
  }
  renderSubTabBar(parent) {
    this.subTabBarEl = parent.createDiv({ cls: "lilbee-catalog-tab-bar lilbee-catalog-sub-tab-bar" });
    const localBtn = this.subTabBarEl.createEl("button", {
      text: MESSAGES.TAB_LOCAL,
      cls: "lilbee-catalog-tab lilbee-catalog-tab-active"
    });
    localBtn.setAttribute("aria-selected", "true");
    localBtn.addEventListener("click", () => this.switchSubTab(SUB_TAB.LOCAL));
    this.hostedTabBtn = this.subTabBarEl.createEl("button", {
      text: MESSAGES.TAB_FRONTIER,
      cls: "lilbee-catalog-tab"
    });
    this.hostedTabBtn.setAttribute("aria-selected", "false");
    this.hostedTabBtn.hide();
    this.hostedTabBtn.addEventListener("click", () => this.switchSubTab(SUB_TAB.HOSTED));
    this.updateSubTabBarVisibility();
  }
  updateSubTabBarVisibility() {
    if (!this.subTabBarEl) return;
    const showSubTabs = tabIdToTask(this.activeTab) !== null;
    this.subTabBarEl.style.display = showSubTabs ? "" : "none";
  }
  switchSubTab(tab) {
    if (this.currentTab === tab) return;
    this.currentTab = tab;
    if (!this.subTabBarEl) return;
    for (const btn of Array.from(this.subTabBarEl.children)) {
      const isActive = tab === SUB_TAB.LOCAL && btn.textContent === MESSAGES.TAB_LOCAL || tab === SUB_TAB.HOSTED && btn.textContent === MESSAGES.TAB_FRONTIER;
      btn.toggleClass("lilbee-catalog-tab-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    }
    this.renderResults();
  }
  updateHostedTabVisibility() {
    if (!this.hostedTabBtn) return;
    const showHosted = tabIdToTask(this.activeTab) !== null && hasReadyHostedRow(this.entries);
    if (showHosted) {
      this.hostedTabBtn.show();
      return;
    }
    this.hostedTabBtn.hide();
    if (this.currentTab === SUB_TAB.HOSTED) this.switchSubTab(SUB_TAB.LOCAL);
  }
  onClose() {
    this.cancelDebouncedSearch();
    this.resultsEl?.removeEventListener("scroll", this.onScroll);
    this.bodyEl?.removeEventListener("focusin", this.onCardFocus);
    this.bodyEl?.removeEventListener("pointerover", this.onCardFocus);
    this.contentEl.removeEventListener("keydown", this.onKeyDown);
    if (this.focusDebounceTimeout !== null) {
      window.clearTimeout(this.focusDebounceTimeout);
      this.focusDebounceTimeout = null;
    }
  }
  onScroll = () => {
    if (!this.resultsEl || this.isFetching || !this.hasMore) return;
    const { scrollTop, clientHeight, scrollHeight } = this.resultsEl;
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX) {
      void this.fetchPage();
    }
  };
  onKeyDown = (e) => {
    if (e.key === "i" && !isTextInputTarget(e.target)) {
      const entry = this.focusedEntry();
      if (entry) {
        e.preventDefault();
        e.stopPropagation();
        new ModelInfoModal(this.app, this.plugin, entry).open();
      }
    }
  };
  renderFilterBar(parent) {
    const filters = parent.createDiv({ cls: "lilbee-catalog-filters" });
    this.renderSelect(filters, "lilbee-catalog-filter-size", CATALOG_FILTERS.SIZE, (v) => {
      this.filterSize = v;
      this.resetAndFetch();
    });
    this.renderSelect(filters, "lilbee-catalog-filter-sort", CATALOG_FILTERS.SORT, (v) => {
      this.filterSort = v;
      this.resetAndFetch();
    });
    const searchInput = filters.createEl("input", {
      cls: "lilbee-catalog-search",
      placeholder: MESSAGES.PLACEHOLDER_SEARCH_MODELS,
      attr: { type: "text" }
    });
    searchInput.addEventListener("input", () => {
      this.filterSearch = searchInput.value;
      this.debouncedSearch();
    });
    this.viewToggleBtn = filters.createEl("button", {
      text: MESSAGES.LABEL_SWITCH_TO_LIST,
      cls: "lilbee-catalog-view-toggle"
    });
    this.viewToggleBtn.addEventListener("click", () => this.toggleView());
    this.updateViewToggleVisibility();
  }
  renderSelect(parent, cls, options, onChange) {
    const select = parent.createEl("select", { cls });
    for (const [value, label] of options) {
      const opt = select.createEl("option", { text: label });
      opt.value = value;
    }
    select.addEventListener("change", () => onChange(select.value));
  }
  toggleView() {
    this.viewMode = this.viewMode === CATALOG_VIEW_MODE.GRID ? CATALOG_VIEW_MODE.LIST : CATALOG_VIEW_MODE.GRID;
    this.updateToggleLabel();
    this.renderResults();
  }
  updateToggleLabel() {
    if (!this.viewToggleBtn) return;
    this.viewToggleBtn.textContent = this.viewMode === CATALOG_VIEW_MODE.GRID ? MESSAGES.LABEL_SWITCH_TO_LIST : MESSAGES.LABEL_SWITCH_TO_GRID;
  }
  resetAndFetch() {
    this.offset = 0;
    this.entries = [];
    if (this.resultsEl) this.resultsEl.empty();
    void this.fetchPage();
  }
  async fetchPage() {
    if (this.isFetching) return;
    this.isFetching = true;
    const params = {
      limit: PAGE_SIZE,
      offset: this.offset,
      sort: this.filterSort
    };
    if (this.filterTask) params.task = this.filterTask;
    if (this.filterSize) params.size = this.filterSize;
    if (this.filterSearch) params.search = this.filterSearch;
    try {
      const result = await this.plugin.api.catalog(params);
      if (result.isErr()) {
        new import_obsidian9.Notice(noticeForResultError(result.error, MESSAGES.ERROR_LOAD_CATALOG));
        return;
      }
      const response = result.value;
      this.hasMore = response.has_more;
      const filtered = this.filterTask ? response.models.filter((m) => m.task === this.filterTask) : response.models;
      this.entries.push(...filtered);
      this.offset += response.models.length;
      this.updateHostedTabVisibility();
      this.renderResults();
    } finally {
      this.isFetching = false;
    }
  }
  renderResults() {
    if (!this.resultsEl) return;
    this.resultsEl.empty();
    if (this.activeTab === CATALOG_TAB.DISCOVER) {
      this.renderDiscoverTab();
      return;
    }
    if (this.activeTab === CATALOG_TAB.LIBRARY) {
      this.renderLibraryTab();
      return;
    }
    if (this.currentTab === SUB_TAB.HOSTED) {
      this.renderHostedResults();
      return;
    }
    this.renderTaskTabLocal();
  }
  renderTaskTabLocal() {
    if (!this.resultsEl) return;
    const localEntries = localRowsOnly(this.entries);
    if (localEntries.length === 0) {
      this.resultsEl.createDiv({
        cls: "lilbee-catalog-empty",
        text: MESSAGES.LABEL_NO_MODELS_FOUND
      });
      return;
    }
    if (this.viewMode === CATALOG_VIEW_MODE.GRID) {
      this.renderGridView(localEntries);
    } else {
      this.renderListView(localEntries);
    }
  }
  renderDiscoverTab() {
    if (!this.resultsEl) return;
    const rails = [
      {
        heading: MESSAGES.RAIL_FOR_YOU,
        help: MESSAGES.RAIL_FOR_YOU_HELP,
        rows: forYouRail(this.entries)
      },
      {
        heading: MESSAGES.RAIL_YOUR_COLLECTION,
        help: MESSAGES.RAIL_YOUR_COLLECTION_HELP,
        rows: yourCollectionRail(this.entries)
      },
      {
        heading: MESSAGES.RAIL_FRESH,
        help: MESSAGES.RAIL_FRESH_HELP,
        rows: freshRail(this.entries)
      }
    ];
    for (const rail of rails) {
      this.renderRail(rail);
    }
  }
  renderRail(rail) {
    if (!this.resultsEl) return;
    const railEl = this.resultsEl.createDiv({ cls: "lilbee-discover-rail" });
    const heading = railEl.createDiv({ cls: "lilbee-discover-rail-heading" });
    heading.createSpan({ text: rail.heading });
    heading.createSpan({ cls: "lilbee-discover-rail-heading-help", text: rail.help });
    const cards = railEl.createDiv({ cls: "lilbee-discover-rail-cards" });
    if (rail.rows.length === 0) {
      cards.createDiv({ cls: "lilbee-discover-rail-empty", text: MESSAGES.RAIL_NO_ITEMS });
      return;
    }
    for (const entry of rail.rows) {
      this.renderCard(cards, entry);
    }
  }
  renderLibraryTab() {
    if (!this.resultsEl) return;
    const installed = this.entries.filter((e) => e.installed);
    if (installed.length === 0) {
      this.resultsEl.createDiv({
        cls: "lilbee-catalog-empty",
        text: MESSAGES.LABEL_NO_MODELS_FOUND
      });
      return;
    }
    if (this.viewMode === CATALOG_VIEW_MODE.GRID) {
      this.renderGridView(installed);
    } else {
      this.renderListView(installed);
    }
  }
  renderHostedResults() {
    if (!this.resultsEl) return;
    const taskForTab = tabIdToTask(this.activeTab);
    const allHosted = hostedRowsOnly(this.entries);
    const rows = taskForTab === null ? allHosted : allHosted.filter((r) => r.task === taskForTab);
    if (rows.length === 0) {
      this.resultsEl.createDiv({
        cls: "lilbee-catalog-empty",
        text: MESSAGES.LABEL_NO_MODELS_FOUND
      });
      return;
    }
    for (const [provider, group] of groupByProvider(rows)) {
      this.resultsEl.createDiv({ cls: "lilbee-catalog-section-heading", text: provider });
      const list = this.resultsEl.createDiv({ cls: "lilbee-catalog-frontier-list" });
      for (const row of group) {
        this.renderHostedRow(list, row);
      }
    }
  }
  renderHostedRow(parent, row) {
    const rowEl = parent.createDiv({ cls: "lilbee-frontier-row" });
    const nameEl = rowEl.createSpan({ cls: "lilbee-frontier-row-name", text: row.display_name });
    const provider = row.provider ?? "";
    renderProviderPill(nameEl, provider);
    const keyStatus = row.key_status ?? KEY_STATUS.MISSING_KEY;
    if (row.source === CATALOG_SOURCE.FRONTIER) {
      renderKeyStatusPill(nameEl, keyStatus);
    }
    rowEl.addEventListener("click", () => {
      if (row.source === CATALOG_SOURCE.FRONTIER && keyStatus === KEY_STATUS.MISSING_KEY) {
        this.close();
        deepLinkToApiKeySettings(this.app, provider);
        return;
      }
      void this.handleUseHosted(row);
    });
  }
  async handleUseHosted(row) {
    const result = await this.setActiveFor(row);
    if (result.isErr()) {
      new import_obsidian9.Notice(noticeForResultError(result.error, MESSAGES.ERROR_SET_MODEL.replace("{model}", row.hf_repo)));
      return;
    }
    void this.plugin.fetchActiveModel();
    this.plugin.refreshSettingsTab();
    this.plugin.refreshOpenChatRails();
    new import_obsidian9.Notice(MESSAGES.NOTICE_MODEL_ACTIVATED(this.activatedRefFor(row)));
    this.close();
  }
  renderGridView(entries) {
    if (!this.resultsEl) return;
    const picks = entries.filter((e) => e.featured);
    const installed = entries.filter((e) => !e.featured && e.installed);
    const rest = entries.filter((e) => !e.featured && !e.installed);
    if (picks.length > 0)
      this.renderSection(MESSAGES.LABEL_OUR_PICKS, picks, "lilbee-catalog-section-heading-featured");
    if (installed.length > 0) this.renderSection(MESSAGES.LABEL_SECTION_INSTALLED, installed);
    for (const [task, group] of this.groupByTask(rest)) {
      this.renderSection(TASK_SECTION_LABEL[task] ?? task, group);
    }
    this.renderViewToggleCta();
  }
  groupByTask(entries) {
    const groups = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      const group = groups.get(entry.task);
      if (group) {
        group.push(entry);
      } else {
        groups.set(entry.task, [entry]);
      }
    }
    return [...groups.entries()];
  }
  renderSection(heading, entries, headingCls) {
    if (!this.resultsEl) return;
    const headingEl = this.resultsEl.createDiv({
      cls: "lilbee-catalog-section-heading",
      text: heading
    });
    if (headingCls) headingEl.addClass(headingCls);
    const grid = this.resultsEl.createDiv({ cls: "lilbee-catalog-grid" });
    for (const entry of entries) {
      this.renderCard(grid, entry);
    }
  }
  renderCard(container, entry) {
    const isActive = this.isActiveEntry(entry);
    renderModelCard(container, entry, {
      showActions: true,
      isActive,
      onPull: (e) => this.handlePull(e),
      onUse: (e, btn) => void this.handleUse(e, btn),
      onRemove: (e, btn) => this.handleRemove(e, btn),
      onInfo: (e) => new ModelInfoModal(this.app, this.plugin, e).open()
    });
  }
  isActiveEntry(entry) {
    return extractHfRepo(this.plugin.activeModel) === entry.hf_repo;
  }
  renderViewToggleCta() {
    if (!this.resultsEl) return;
    const cta = this.resultsEl.createDiv({ cls: "lilbee-view-toggle-cta" });
    cta.createSpan({ text: MESSAGES.LABEL_VIEW_TOGGLE_CTA });
    const btn = cta.createEl("button", { text: MESSAGES.LABEL_SWITCH_TO_LIST });
    btn.addEventListener("click", () => this.toggleView());
  }
  renderListView(entries) {
    if (!this.resultsEl) return;
    const listEl = this.resultsEl.createDiv({ cls: "lilbee-catalog-list" });
    this.renderListHeader(listEl);
    const sorted = this.sortEntries(entries);
    for (const entry of sorted) {
      this.renderListRow(listEl, entry);
    }
  }
  renderListHeader(listEl) {
    const header = listEl.createDiv({ cls: "lilbee-catalog-list-header" });
    const cols = [
      { key: "name", label: MESSAGES.LABEL_NAME, cls: "lilbee-catalog-list-col-name" },
      { key: "task", label: MESSAGES.LABEL_TASK, cls: "lilbee-catalog-list-col-task" },
      { key: "size", label: MESSAGES.LABEL_SIZE, cls: "lilbee-catalog-list-col-size" },
      { key: "downloads", label: MESSAGES.LABEL_DOWNLOADS, cls: "lilbee-catalog-list-col-downloads" },
      { key: "info", label: "", cls: "lilbee-catalog-list-col-info" },
      { key: "action", label: "", cls: "lilbee-catalog-list-col-action" }
    ];
    for (const col of cols) {
      const el = header.createSpan({ text: col.label, cls: col.cls });
      if (col.key !== "action" && col.key !== "info") {
        el.addEventListener("click", () => this.handleSort(col.key));
      }
    }
  }
  renderListRow(listEl, entry) {
    const row = listEl.createDiv({ cls: "lilbee-catalog-list-row" });
    if (entry.compat === MODEL_COMPAT.UNSUPPORTED) row.addClass("is-unsupported");
    const nameText = entry.featured ? `\u2605 ${entry.display_name}` : entry.display_name;
    const nameEl = row.createSpan({ text: nameText, cls: "lilbee-catalog-list-col-name" });
    nameEl.setAttribute("title", entry.display_name);
    renderCompatTag(nameEl, entry);
    row.createSpan({ text: entry.task, cls: "lilbee-catalog-list-col-task" });
    row.createSpan({ text: `${entry.size_gb} GB`, cls: "lilbee-catalog-list-col-size" });
    row.createSpan({
      text: formatAbbreviatedCount(entry.downloads),
      cls: "lilbee-catalog-list-col-downloads"
    });
    const infoEl = row.createDiv({ cls: "lilbee-catalog-list-col-info" });
    const infoBtn = infoEl.createEl("button", {
      cls: "lilbee-model-card-info",
      attr: {
        type: "button",
        "aria-label": MESSAGES.LABEL_MODEL_INFO_BTN,
        title: MESSAGES.LABEL_MODEL_INFO_BTN
      }
    });
    (0, import_obsidian9.setIcon)(infoBtn, "info");
    infoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      new ModelInfoModal(this.app, this.plugin, entry).open();
    });
    const actionEl = row.createDiv({ cls: "lilbee-catalog-list-col-action" });
    const isActive = this.isActiveEntry(entry);
    if (isActive) {
      actionEl.createSpan({ text: MESSAGES.LABEL_ACTIVE, cls: "lilbee-catalog-active" });
    } else if (entry.installed) {
      const useBtn = actionEl.createEl("button", { text: MESSAGES.BUTTON_USE, cls: "lilbee-catalog-use" });
      useBtn.addEventListener("click", () => void this.handleUse(entry, useBtn));
      const removeBtn = actionEl.createEl("button", {
        text: MESSAGES.BUTTON_REMOVE,
        cls: "lilbee-catalog-remove"
      });
      removeBtn.addEventListener("click", () => this.handleRemove(entry, removeBtn));
    } else if (entry.compat === MODEL_COMPAT.UNSUPPORTED) {
      actionEl.createEl("button", {
        text: MESSAGES.BUTTON_PULL,
        cls: "lilbee-catalog-pull is-gated",
        attr: { disabled: "true", title: MESSAGES.TOOLTIP_PULL_UNSUPPORTED }
      });
    } else {
      const pullBtn = actionEl.createEl("button", { text: MESSAGES.BUTTON_PULL, cls: "lilbee-catalog-pull" });
      pullBtn.addEventListener("click", () => this.handlePull(entry));
    }
  }
  handleSort(column) {
    if (this.sortColumn === column) {
      this.sortAscending = !this.sortAscending;
    } else {
      this.sortColumn = column;
      this.sortAscending = true;
    }
    this.renderResults();
  }
  sortEntries(entries) {
    if (!this.sortColumn) return entries;
    const sorted = [...entries];
    const dir = this.sortAscending ? 1 : -1;
    sorted.sort((a, b) => {
      const va = this.getSortValue(a, this.sortColumn);
      const vb = this.getSortValue(b, this.sortColumn);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return sorted;
  }
  getSortValue(entry, column) {
    switch (column) {
      case "name":
        return entry.display_name;
      case "task":
        return entry.task;
      case "size":
        return entry.size_gb;
      case "downloads":
        return entry.downloads;
      default:
        return "";
    }
  }
  handleRemove(entry, btn) {
    const confirmModal = new ConfirmModal(this.app, MESSAGES.NOTICE_CONFIRM_REMOVE(entry.hf_repo));
    confirmModal.open();
    void confirmModal.result.then((confirmed) => {
      if (!confirmed) return;
      void this.executeRemove(entry, btn);
    });
  }
  async executeRemove(entry, btn) {
    const taskId = this.plugin.taskQueue.enqueue(`Remove ${entry.hf_repo}`, TASK_TYPE.DELETE);
    if (taskId === null) {
      new import_obsidian9.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    btn.setText(MESSAGES.STATUS_REMOVING);
    btn.disabled = true;
    this.plugin.taskQueue.update(taskId, -1, entry.hf_repo);
    const result = await this.plugin.api.deleteModel(entry.hf_repo, entry.source);
    if (result.isErr()) {
      new import_obsidian9.Notice(
        noticeForResultError(result.error, MESSAGES.ERROR_REMOVE_MODEL.replace("{model}", entry.hf_repo))
      );
      this.plugin.taskQueue.fail(taskId, errorMessage(result.error, result.error.message));
      btn.setText(MESSAGES.BUTTON_REMOVE);
      btn.disabled = false;
      return;
    }
    this.plugin.taskQueue.complete(taskId);
    new import_obsidian9.Notice(MESSAGES.NOTICE_REMOVED(entry.hf_repo));
    void this.plugin.fetchActiveModel();
    this.resetAndFetch();
  }
  async handleUse(entry, btn) {
    btn.setText(MESSAGES.STATUS_SETTING);
    btn.disabled = true;
    const result = await this.setActiveFor(entry);
    if (result.isErr()) {
      new import_obsidian9.Notice(noticeForResultError(result.error, MESSAGES.ERROR_SET_MODEL.replace("{model}", entry.hf_repo)));
      btn.setText(MESSAGES.BUTTON_USE);
      btn.disabled = false;
      return;
    }
    void this.plugin.fetchActiveModel();
    this.plugin.refreshSettingsTab();
    this.plugin.refreshOpenChatRails();
    new import_obsidian9.Notice(MESSAGES.NOTICE_MODEL_ACTIVATED(this.activatedRefFor(entry)));
    this.resetAndFetch();
  }
  /** Identifier to surface in user-facing toasts. */
  activatedRefFor(entry) {
    return entry.display_name;
  }
  async setActiveFor(entry) {
    const ref = nativeModelRef(entry.hf_repo, entry.gguf_filename);
    if (entry.task === MODEL_TASK.EMBEDDING) {
      return this.plugin.api.setEmbeddingModel(ref);
    }
    if (entry.task === MODEL_TASK.RERANK) {
      return this.plugin.api.setRerankerModel(ref);
    }
    if (entry.task === MODEL_TASK.VISION) {
      return this.plugin.api.setVisionModel(ref);
    }
    const result = await this.plugin.api.setChatModel(ref);
    if (result.isOk()) this.plugin.activeModel = ref;
    return result;
  }
  handlePull(entry) {
    if (entry.compat === MODEL_COMPAT.UNSUPPORTED) {
      new import_obsidian9.Notice(MESSAGES.TOOLTIP_PULL_UNSUPPORTED);
      return;
    }
    const confirmModal = new ConfirmPullModal(this.app, {
      displayName: entry.display_name,
      sizeGb: entry.size_gb,
      minRamGb: entry.min_ram_gb,
      systemMemGb: getRelevantSystemMemoryGB(this.plugin.settings.serverMode)
    });
    confirmModal.open();
    void confirmModal.result.then((confirmed) => {
      if (!confirmed) return;
      void this.executePull(entry);
    });
  }
  async executePull(entry) {
    const taskId = this.plugin.taskQueue.enqueue(`Pull ${entry.hf_repo}`, TASK_TYPE.PULL);
    if (taskId === null) {
      new import_obsidian9.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    const controller = new AbortController();
    this.plugin.taskQueue.registerAbort(taskId, controller);
    const pullErrorPrefix = MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.hf_repo);
    try {
      for await (const event of this.plugin.api.pullModel(entry.hf_repo, "native", controller.signal)) {
        if (event.event === SSE_EVENT.PROGRESS) {
          const d = event.data;
          const pct = percentFromSse(d);
          if (pct !== void 0) {
            this.plugin.taskQueue.update(taskId, pct, entry.hf_repo, {
              current: d.current,
              total: d.total
            });
          }
        } else if (event.event === SSE_EVENT.ERROR) {
          const d = event.data;
          const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
          new import_obsidian9.Notice(`${pullErrorPrefix}: ${msg}`);
          this.plugin.taskQueue.fail(taskId, msg);
          return;
        }
      }
    } catch (err3) {
      if (err3 instanceof Error && err3.name === ERROR_NAME.ABORT_ERROR) {
        new import_obsidian9.Notice(MESSAGES.NOTICE_PULL_CANCELLED);
        this.plugin.taskQueue.cancel(taskId);
      } else {
        const msg = errorMessage(err3, MESSAGES.ERROR_UNKNOWN);
        new import_obsidian9.Notice(`${pullErrorPrefix}: ${msg}`);
        this.plugin.taskQueue.fail(taskId, msg);
      }
      return;
    }
    this.plugin.taskQueue.complete(taskId);
    const result = await this.setActiveFor(entry);
    if (result.isErr()) {
      new import_obsidian9.Notice(noticeForResultError(result.error, MESSAGES.ERROR_SET_MODEL.replace("{model}", entry.hf_repo)));
      void this.plugin.fetchActiveModel();
      this.resetAndFetch();
      return;
    }
    void this.plugin.fetchActiveModel();
    this.plugin.refreshSettingsTab();
    this.plugin.refreshOpenChatRails();
    new import_obsidian9.Notice(MESSAGES.NOTICE_MODEL_ACTIVATED_FULL(this.activatedRefFor(entry)));
    this.resetAndFetch();
  }
};
function findCardElement(target2) {
  let el = target2;
  while (el) {
    if (el.dataset?.repo) return el;
    el = el.parentElement ?? null;
  }
  return null;
}
function isTextInputTarget(target2) {
  const el = target2;
  if (!el?.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

// src/views/model-picker-modal.ts
var import_obsidian10 = require("obsidian");
var SEARCH_DEBOUNCE_MS = 100;
var PAGE_SIZE2 = 50;
var SET_MODEL_RETRIES = 4;
var SET_MODEL_RETRY_MS = 600;
var ModelPickerModal = class extends import_obsidian10.Modal {
  plugin;
  pickerScope;
  allRows = [];
  filteredRows = [];
  filterText = "";
  searchInputEl = null;
  listEl = null;
  highlightedIndex = 0;
  filterTimer = null;
  constructor(app, plugin, pickerScope) {
    super(app);
    this.plugin = plugin;
    this.pickerScope = pickerScope;
    tagModalChrome(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-model-picker-modal");
    contentEl.createEl("h2", {
      text: this.pickerScope === MODEL_TASK.CHAT ? MESSAGES.MODEL_PICKER_TITLE_CHAT : MESSAGES.MODEL_PICKER_TITLE_EMBED
    });
    this.renderSearchInput(contentEl);
    this.listEl = contentEl.createDiv({ cls: "lilbee-model-picker-list" });
    this.registerKeyHandlers();
    void this.fetchAndRender();
  }
  onClose() {
    if (this.filterTimer !== null) window.clearTimeout(this.filterTimer);
  }
  renderSearchInput(parent) {
    const wrap = parent.createDiv({ cls: "lilbee-model-picker-search" });
    this.searchInputEl = wrap.createEl("input", {
      cls: "lilbee-model-picker-search-input",
      attr: { type: "text" },
      placeholder: MESSAGES.MODEL_PICKER_SEARCH_PLACEHOLDER
    });
    this.searchInputEl.addEventListener("input", () => {
      const value = this.searchInputEl?.value ?? "";
      if (this.filterTimer !== null) window.clearTimeout(this.filterTimer);
      this.filterTimer = window.setTimeout(() => {
        this.filterText = value;
        this.applyFilterAndRender();
      }, SEARCH_DEBOUNCE_MS);
    });
    window.setTimeout(() => this.searchInputEl?.focus(), 0);
  }
  registerKeyHandlers() {
    const scope = this.scope;
    if (!scope || typeof scope.register !== "function") return;
    scope.register([], "Enter", () => this.activateHighlighted());
    scope.register([], "Escape", () => {
      this.close();
      return false;
    });
    scope.register([], "ArrowDown", () => {
      this.moveHighlight(1);
      return false;
    });
    scope.register([], "ArrowUp", () => {
      this.moveHighlight(-1);
      return false;
    });
  }
  moveHighlight(delta) {
    if (this.filteredRows.length === 0) return;
    this.highlightedIndex = (this.highlightedIndex + delta + this.filteredRows.length) % this.filteredRows.length;
    this.repaintHighlight();
  }
  repaintHighlight() {
    if (!this.listEl) return;
    const rows = this.listEl.querySelectorAll(".lilbee-model-picker-row");
    for (let i2 = 0; i2 < rows.length; i2++) {
      rows[i2].toggleClass("lilbee-model-picker-row-highlighted", i2 === this.highlightedIndex);
    }
  }
  activateHighlighted() {
    const row = this.filteredRows[this.highlightedIndex];
    if (!row) return;
    void this.activateRow(row);
  }
  async fetchAndRender() {
    const taskFilter = this.pickerScope;
    const result = await this.plugin.api.catalog({ task: taskFilter, limit: PAGE_SIZE2 });
    if (result.isErr()) {
      new import_obsidian10.Notice(MESSAGES.ERROR_LOAD_CATALOG);
      return;
    }
    this.allRows = result.value.models.filter((m) => m.task === taskFilter);
    this.applyFilterAndRender();
  }
  applyFilterAndRender() {
    const local = localRowsOnly(this.allRows);
    const hosted = hasReadyHostedRow(this.allRows) ? hostedRowsOnly(this.allRows) : [];
    const visible = [...local, ...hosted];
    this.filteredRows = filterRowsByText(visible, this.filterText);
    this.highlightedIndex = 0;
    this.renderList();
  }
  renderList() {
    if (!this.listEl) return;
    this.listEl.empty();
    if (this.filteredRows.length === 0) {
      this.listEl.createDiv({ cls: "lilbee-model-picker-empty", text: MESSAGES.MODEL_PICKER_EMPTY });
      return;
    }
    const local = this.filteredRows.filter((r) => !HOSTED_SOURCES.has(r.source));
    const hosted = this.filteredRows.filter((r) => HOSTED_SOURCES.has(r.source));
    if (local.length > 0) {
      this.listEl.createDiv({
        cls: "lilbee-model-picker-section-header",
        text: MESSAGES.MODEL_PICKER_LOCAL_HEADING
      });
      for (const row of local) this.renderRow(this.listEl, row);
    }
    for (const [provider, group] of groupByProvider(hosted)) {
      this.listEl.createDiv({ cls: "lilbee-model-picker-section-header", text: provider });
      for (const row of group) this.renderRow(this.listEl, row);
    }
    this.repaintHighlight();
  }
  renderRow(parent, row) {
    const rowEl = parent.createDiv({ cls: "lilbee-model-picker-row" });
    const nameRow = rowEl.createDiv({ cls: "lilbee-model-picker-row-name" });
    nameRow.createSpan({ text: row.display_name, cls: "lilbee-model-picker-row-display" });
    if (row.installed) {
      renderPill(nameRow, MESSAGES.LABEL_INSTALLED, PILL_CLS.INSTALLED);
    }
    renderFitChip(nameRow, row.fit);
    if (HOSTED_SOURCES.has(row.source)) {
      const provider = row.provider ?? "";
      renderProviderPill(nameRow, provider);
      if (row.source === CATALOG_SOURCE.FRONTIER) {
        renderKeyStatusPill(nameRow, row.key_status ?? KEY_STATUS.MISSING_KEY);
      }
    }
    if (row.size_gb > 0) {
      rowEl.createDiv({
        cls: "lilbee-model-picker-row-meta",
        text: `${row.size_gb} GB${row.quality_tier ? ` \xB7 ${row.quality_tier}` : ""}`
      });
    }
    rowEl.addEventListener("click", () => {
      void this.activateRow(row);
    });
  }
  async activateRow(row) {
    if (row.source === CATALOG_SOURCE.FRONTIER) {
      const keyStatus = row.key_status ?? KEY_STATUS.MISSING_KEY;
      if (keyStatus === KEY_STATUS.MISSING_KEY) {
        const provider = row.provider ?? "";
        this.close();
        deepLinkToApiKeySettings(this.app, provider);
        return;
      }
    }
    const result = await this.setActiveModelWithRetry(row.hf_repo);
    if (result.isErr()) {
      new import_obsidian10.Notice(MESSAGES.ERROR_SET_MODEL.replace("{model}", row.hf_repo));
      return;
    }
    if (this.pickerScope === MODEL_TASK.CHAT) this.plugin.activeModel = row.hf_repo;
    void this.plugin.fetchActiveModel();
    this.plugin.refreshSettingsTab();
    new import_obsidian10.Notice(MESSAGES.NOTICE_MODEL_ACTIVATED(row.display_name));
    this.close();
  }
  /**
   * Set the model, retrying on error. A set issued right after a pull can
   * reach the server mid worker-reload and return a transient error even
   * though the model is applied; the PUT is idempotent, so retry a few times
   * before reporting failure. A successful retry also confirms the model
   * took, so a transient not-ready response no longer surfaces as "Failed to
   * set" while the model quietly activates.
   */
  async setActiveModelWithRetry(repo) {
    const set = (m) => this.pickerScope === MODEL_TASK.CHAT ? this.plugin.api.setChatModel(m) : this.plugin.api.setEmbeddingModel(m);
    let result = await set(repo);
    for (let attempt = 0; attempt < SET_MODEL_RETRIES && result.isErr(); attempt++) {
      await new Promise((resolve2) => window.setTimeout(resolve2, SET_MODEL_RETRY_MS));
      result = await set(repo);
    }
    return result;
  }
};
function filterRowsByText(rows, text) {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "") return rows;
  return rows.filter((r) => r.display_name.toLowerCase().includes(trimmed));
}

// src/views/setup-wizard.ts
var import_obsidian11 = require("obsidian");
var INDICATOR_STEPS = [
  { step: WIZARD_STEP.SERVER_MODE, key: "server", label: "Server" },
  { step: WIZARD_STEP.MODEL_PICKER, key: "model", label: "Model" },
  { step: WIZARD_STEP.EMBEDDING_PICKER, key: "embedding", label: "Embed" },
  { step: WIZARD_STEP.SYNC, key: "sync", label: "Sync" },
  { step: WIZARD_STEP.WIKI, key: "wiki", label: "Wiki" },
  { step: WIZARD_STEP.DONE, key: "done", label: "Done" }
];
var STEP_KEY = {
  [WIZARD_STEP.WELCOME]: "welcome",
  [WIZARD_STEP.SERVER_MODE]: "server",
  [WIZARD_STEP.MODEL_PICKER]: "model",
  [WIZARD_STEP.EMBEDDING_PICKER]: "embedding",
  [WIZARD_STEP.SYNC]: "sync",
  [WIZARD_STEP.WIKI]: "wiki",
  [WIZARD_STEP.DONE]: "done"
};
function recommendedIndex(models, memGB) {
  if (models.length === 0) return 0;
  const installedFitIdx = bestInstalledFitIndex(models, memGB);
  if (installedFitIdx >= 0) return installedFitIdx;
  if (memGB === null) return 0;
  return largestFitIndex(models, memGB);
}
function bestInstalledFitIndex(models, memGB) {
  let best = -1;
  let bestRam = -1;
  for (let i2 = 0; i2 < models.length; i2++) {
    const m = models[i2];
    if (!m.installed) continue;
    if (memGB !== null && m.min_ram_gb > memGB) continue;
    if (m.min_ram_gb >= bestRam) {
      best = i2;
      bestRam = m.min_ram_gb;
    }
  }
  return best;
}
function largestFitIndex(models, memGB) {
  let best = 0;
  let bestRam = 0;
  for (let i2 = 0; i2 < models.length; i2++) {
    if (models[i2].min_ram_gb <= memGB && models[i2].min_ram_gb >= bestRam) {
      best = i2;
      bestRam = models[i2].min_ram_gb;
    }
  }
  return best;
}
var PREFERRED_FAMILIES = [
  "gemma-4",
  "gemma-3",
  "gemma-2",
  "qwen3-coder",
  "qwen3",
  "qwen2",
  "llama-3",
  "phi-3",
  "mistral",
  "smollm"
];
var MAX_FEATURED_PICKS = 8;
var SERVER_SETUP_PHASES = [
  {
    key: MANAGED_PHASE.DOWNLOADING,
    pending: MESSAGES.WIZARD_SETUP_DOWNLOAD_PENDING,
    active: MESSAGES.WIZARD_SETUP_DOWNLOAD_ACTIVE,
    done: MESSAGES.WIZARD_SETUP_DOWNLOAD_DONE,
    hint: MESSAGES.WIZARD_SETUP_DOWNLOAD_HINT
  },
  {
    key: MANAGED_PHASE.STARTING,
    pending: MESSAGES.WIZARD_SETUP_START_PENDING,
    active: MESSAGES.WIZARD_SETUP_START_ACTIVE,
    done: MESSAGES.WIZARD_SETUP_START_DONE,
    hint: MESSAGES.WIZARD_SETUP_START_HINT
  },
  {
    key: MANAGED_PHASE.READY,
    pending: MESSAGES.WIZARD_SETUP_READY_PENDING,
    active: MESSAGES.WIZARD_SETUP_READY_DONE,
    done: MESSAGES.WIZARD_SETUP_READY_DONE,
    hint: ""
  }
];
function pickNativeChatModels(models, filter = () => true) {
  const eligible = models.filter(filter);
  const seen = /* @__PURE__ */ new Set();
  const ordered = [];
  for (const prefix of PREFERRED_FAMILIES) {
    for (const m of eligible) {
      if (m.hf_repo.toLowerCase().includes(prefix) && !seen.has(m.hf_repo)) {
        ordered.push(m);
        seen.add(m.hf_repo);
        if (ordered.length >= MAX_FEATURED_PICKS) return ordered;
      }
    }
  }
  for (const m of eligible) {
    if (!seen.has(m.hf_repo)) {
      ordered.push(m);
      seen.add(m.hf_repo);
      if (ordered.length >= MAX_FEATURED_PICKS) break;
    }
  }
  return ordered;
}
var SetupWizard = class extends import_obsidian11.Modal {
  plugin;
  step = 0;
  selectedModel = null;
  featuredModels = [];
  pullController = null;
  syncController = null;
  syncResult = null;
  pulledModelName = "";
  selectedEmbedding = null;
  embeddingModels = [];
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-wizard");
    this.renderStep();
  }
  onClose() {
    this.pullController?.abort();
    this.syncController?.abort();
  }
  renderStep() {
    const { contentEl } = this;
    contentEl.empty();
    switch (this.step) {
      case WIZARD_STEP.WELCOME:
        this.renderWelcome();
        break;
      case WIZARD_STEP.SERVER_MODE:
        this.renderServerMode();
        break;
      case WIZARD_STEP.MODEL_PICKER:
        this.renderModelPicker();
        break;
      case WIZARD_STEP.EMBEDDING_PICKER:
        this.renderEmbeddingPicker();
        break;
      case WIZARD_STEP.SYNC:
        this.renderSync();
        break;
      case WIZARD_STEP.WIKI:
        this.renderWiki();
        break;
      case WIZARD_STEP.DONE:
        this.renderDone();
        break;
    }
  }
  /**
   * Build the step frame: outer `<div data-step="...">` with a left rail and a
   * numbered breadcrumb at the top. Every `render<Step>` method calls this to
   * get a consistent scaffold.
   */
  beginStep() {
    const { contentEl } = this;
    const step = contentEl.createDiv({ cls: "lilbee-wizard-step" });
    step.dataset.step = STEP_KEY[this.step];
    step.createDiv({ cls: "lilbee-wizard-rail" });
    this.renderStepIndicator(step);
    return step;
  }
  renderStepIndicator(container) {
    const indicator = container.createDiv({ cls: "lilbee-wizard-step-indicator" });
    for (let i2 = 0; i2 < INDICATOR_STEPS.length; i2++) {
      const meta = INDICATOR_STEPS[i2];
      if (i2 > 0) {
        const line = indicator.createDiv({ cls: "lilbee-wizard-step-line" });
        if (meta.step <= this.step) line.addClass("is-done");
      }
      const slot = indicator.createDiv({ cls: "lilbee-wizard-step-slot" });
      slot.dataset.step = meta.key;
      const circle = slot.createDiv({ cls: "lilbee-wizard-step-circle" });
      const isActive = meta.step === this.step;
      const isDone = meta.step < this.step;
      if (isActive) {
        circle.addClass("is-active");
        slot.addClass("is-active");
      }
      if (isDone) {
        circle.addClass("is-done");
        slot.addClass("is-done");
      }
      circle.setText(isDone ? "\u2713" : String(i2 + 1));
      slot.createDiv({ cls: "lilbee-wizard-step-label", text: meta.label });
    }
  }
  /**
   * Step header: a Task-Center-style uppercase badge (`STEP 03 · MODEL`)
   * followed by the h2 title. The badge carries the step's semantic color.
   */
  renderStepHeader(container, title) {
    const meta = INDICATOR_STEPS.find((m) => m.step === this.step);
    const header = container.createDiv({ cls: "lilbee-wizard-step-header" });
    if (meta) {
      const badge = header.createSpan({ cls: "lilbee-wizard-step-badge" });
      badge.setText(
        MESSAGES.WIZARD_STEP_BADGE.replace(
          "{num}",
          String(INDICATOR_STEPS.indexOf(meta) + 1).padStart(2, "0")
        ).replace("{label}", meta.label.toUpperCase())
      );
    }
    header.createEl("h2", { text: title });
  }
  /** Task-Center-style section heading: uppercase, letter-spaced, muted. */
  renderSectionHeading(container, text) {
    container.createDiv({ cls: "lilbee-wizard-section-heading", text });
  }
  renderWelcome() {
    const step = this.beginStep();
    this.renderStepHeader(step, MESSAGES.TITLE_WELCOME);
    step.createEl("p", { text: MESSAGES.WIZARD_INTRO_DESC });
    this.renderSectionHeading(step, MESSAGES.WIZARD_INTRO_STEPS);
    const ul = step.createEl("ul", { cls: "lilbee-wizard-intro-list" });
    ul.createEl("li", { text: MESSAGES.WIZARD_STEP_CHOOSE_SERVER });
    ul.createEl("li", { text: MESSAGES.WIZARD_STEP_CHOOSE_MODEL });
    ul.createEl("li", { text: MESSAGES.WIZARD_STEP_INDEX });
    const localityHint = this.plugin.settings.serverMode === SERVER_MODE.EXTERNAL ? MESSAGES.WIZARD_LOCAL_ONLY_EXTERNAL : MESSAGES.WIZARD_LOCAL_ONLY_MANAGED;
    step.createEl("p", { text: localityHint, cls: "lilbee-wizard-hint" });
    const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
    const skipBtn = actions.createEl("button", { text: MESSAGES.BUTTON_SKIP_SETUP });
    skipBtn.addEventListener("click", () => this.skip());
    const startBtn = actions.createEl("button", { text: MESSAGES.BUTTON_GET_STARTED, cls: "mod-cta" });
    startBtn.addEventListener("click", () => this.next());
  }
  renderServerMode() {
    const step = this.beginStep();
    this.renderStepHeader(step, MESSAGES.TITLE_SERVER_MODE);
    let mode = this.plugin.settings.serverMode === SERVER_MODE.EXTERNAL ? SERVER_MODE.EXTERNAL : SERVER_MODE.MANAGED;
    const managedOption = step.createDiv({
      cls: `lilbee-wizard-model-option${mode === SERVER_MODE.MANAGED ? " selected" : ""}`
    });
    managedOption.createEl("strong", { text: MESSAGES.TITLE_MANAGED_RECOMMENDED });
    managedOption.createEl("p", { text: MESSAGES.WIZARD_MANAGED_DESC });
    const externalOption = step.createDiv({
      cls: `lilbee-wizard-model-option${mode === SERVER_MODE.EXTERNAL ? " selected" : ""}`
    });
    externalOption.createEl("strong", { text: MESSAGES.TITLE_EXTERNAL });
    externalOption.createEl("p", { text: MESSAGES.WIZARD_EXTERNAL_DESC });
    const externalFields = step.createDiv({ cls: "lilbee-wizard-external-fields" });
    externalFields.style.display = mode === SERVER_MODE.EXTERNAL ? "" : "none";
    const urlLabel = externalFields.createDiv({ cls: "lilbee-wizard-field-label" });
    urlLabel.setText(MESSAGES.LABEL_SERVER_URL);
    const urlInput = externalFields.createEl("input", {
      cls: "lilbee-wizard-url-input",
      placeholder: MESSAGES.PLACEHOLDER_HTTP_LOCALHOST,
      attr: { type: "text" }
    });
    urlInput.value = this.plugin.settings.serverUrl;
    const tokenLabel = externalFields.createDiv({ cls: "lilbee-wizard-field-label" });
    tokenLabel.setText(MESSAGES.LABEL_MANUAL_TOKEN);
    const tokenInput = externalFields.createEl("input", {
      cls: "lilbee-wizard-url-input",
      placeholder: MESSAGES.PLACEHOLDER_MANUAL_TOKEN,
      attr: { type: "password" }
    });
    tokenInput.value = this.plugin.settings.manualToken;
    externalFields.createDiv({
      cls: "lilbee-wizard-hint",
      text: MESSAGES.WIZARD_EXTERNAL_TOKEN_HINT
    });
    const statusEl = step.createDiv({ cls: "lilbee-wizard-status" });
    const { panel, setPhase } = this.renderServerSetupPanel(step);
    const selectManaged = () => {
      mode = SERVER_MODE.MANAGED;
      managedOption.classList.add("selected");
      externalOption.classList.remove("selected");
      externalFields.hide();
      statusEl.setText("");
    };
    const selectExternal = () => {
      mode = SERVER_MODE.EXTERNAL;
      externalOption.classList.add("selected");
      managedOption.classList.remove("selected");
      externalFields.show();
    };
    managedOption.addEventListener("click", selectManaged);
    externalOption.addEventListener("click", selectExternal);
    const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
    const backBtn = actions.createEl("button", { text: MESSAGES.BUTTON_BACK });
    backBtn.addEventListener("click", () => this.back());
    const skipBtn = actions.createEl("button", { text: MESSAGES.BUTTON_SKIP_SETUP });
    skipBtn.addEventListener("click", () => this.skip());
    const nextBtn = actions.createEl("button", { text: MESSAGES.BUTTON_NEXT, cls: "mod-cta" });
    nextBtn.addEventListener("click", () => {
      if (mode === SERVER_MODE.MANAGED) {
        this.plugin.settings.serverMode = SERVER_MODE.MANAGED;
        nextBtn.disabled = true;
        void this.startManagedAndAdvance(step, panel, setPhase, statusEl, nextBtn, selectExternal);
      } else {
        this.plugin.settings.serverUrl = String(urlInput.value || "").trim() || "http://127.0.0.1:7433";
        this.plugin.settings.manualToken = String(tokenInput.value || "").trim();
        this.plugin.settings.serverMode = SERVER_MODE.EXTERNAL;
        statusEl.setText(MESSAGES.STATUS_CHECKING_CONNECTION);
        nextBtn.disabled = true;
        void this.checkExternalAndAdvance(statusEl, nextBtn);
      }
    });
  }
  async startManagedAndAdvance(step, panel, setPhase, statusEl, nextBtn, selectExternal) {
    statusEl.setText("");
    let panelShown = false;
    let failed = false;
    const onProgress = (event) => {
      if (!panelShown) {
        panel.show();
        step.querySelector(".lilbee-wizard-rail")?.classList.add("is-active");
        panelShown = true;
      }
      setPhase(event.phase, event.message, event.percent);
      if (event.phase === MANAGED_PHASE.ERROR) failed = true;
    };
    try {
      const outcome = await this.plugin.ensureManagedConsentThenStart(onProgress);
      if (outcome.kind === SETUP_OUTCOME.SWITCHED_TO_EXTERNAL) {
        panel.hide();
        selectExternal();
        nextBtn.disabled = false;
        return;
      }
      if (outcome.kind === SETUP_OUTCOME.CANCELED) {
        panel.hide();
        nextBtn.disabled = false;
        return;
      }
      if (failed) {
        statusEl.setText(MESSAGES.ERROR_START_SERVER);
        nextBtn.disabled = false;
        return;
      }
      setPhase(MANAGED_PHASE.READY);
      this.step = WIZARD_STEP.MODEL_PICKER;
      this.renderStep();
    } catch {
      panel.hide();
      statusEl.setText(MESSAGES.ERROR_START_SERVER);
      nextBtn.disabled = false;
    }
  }
  /**
   * Build the managed-server setup panel: a header (spinner + "Setting up
   * lilbee", flipping to a check + "lilbee server is running" once ready)
   * above three phase rows whose dots light up as the server moves
   * Downloading → Starting → Ready. A gate line under the rows states the
   * step won't advance until the server is up. Returns `setPhase`, which the
   * start flow calls with each progress event. The panel starts hidden.
   */
  renderServerSetupPanel(step) {
    const panel = step.createDiv({ cls: "lilbee-wizard-setup" });
    panel.hide();
    const head = panel.createDiv({ cls: "lilbee-wizard-setup-head" });
    const spinner = head.createSpan({ cls: "lilbee-wizard-setup-spinner" });
    const headText = head.createSpan({ cls: "lilbee-wizard-setup-head-text", text: MESSAGES.WIZARD_SETUP_HEAD });
    const rows = SERVER_SETUP_PHASES.map((meta) => {
      const row = panel.createDiv({ cls: "lilbee-wizard-phase" });
      row.dataset.phase = meta.key;
      const line = row.createDiv({ cls: "lilbee-wizard-phase-line" });
      line.createSpan({ cls: "lilbee-wizard-phase-dot" });
      const label = line.createSpan({ cls: "lilbee-wizard-phase-label", text: meta.pending });
      const detail = row.createDiv({ cls: "lilbee-wizard-phase-detail" });
      detail.hide();
      const bar = detail.createDiv({ cls: "lilbee-progress-bar-container" });
      const fill = bar.createDiv({ cls: "lilbee-wizard-progress-fill lilbee-progress-indeterminate" });
      const hint = detail.createDiv({ cls: "lilbee-wizard-phase-hint", text: meta.hint });
      return { meta, row, label, detail, fill, hint };
    });
    const gate = panel.createDiv({ cls: "lilbee-wizard-setup-gate", text: MESSAGES.WIZARD_SETUP_GATE });
    const source = panel.createDiv({ cls: "lilbee-wizard-setup-source", text: `${MESSAGES.WIZARD_SETUP_SOURCE} ` });
    const sourceLink = source.createEl("a", { text: MESSAGES.LINK_LILBEE_REPO });
    sourceLink.setAttribute("href", LILBEE_REPO_URL);
    const order = SERVER_SETUP_PHASES.map((m) => m.key);
    const setPhase = (phase, message, percent) => {
      const idx = order.indexOf(phase);
      if (percent !== void 0 && idx >= 0) setDeterminateProgress(rows[idx].fill, percent);
      if (idx < 0) {
        spinner.hide();
        head.classList.add("is-error");
        headText.setText(message || MESSAGES.ERROR_START_SERVER);
        return;
      }
      head.classList.remove("is-error", "is-ready");
      spinner.show();
      gate.show();
      headText.setText(MESSAGES.WIZARD_SETUP_HEAD);
      const terminal = idx === order.length - 1;
      for (let i2 = 0; i2 < rows.length; i2++) {
        const { meta, row, label, detail, hint } = rows[i2];
        row.classList.remove("is-active", "is-done");
        detail.hide();
        if (i2 < idx || i2 === idx && terminal) {
          row.classList.add("is-done");
          label.setText(meta.done);
        } else if (i2 === idx) {
          row.classList.add("is-active");
          label.setText(meta.active);
          hint.setText(message ?? meta.hint);
          detail.show();
        } else {
          label.setText(meta.pending);
          hint.setText(meta.hint);
        }
      }
      if (terminal) {
        spinner.hide();
        head.classList.add("is-ready");
        headText.setText(MESSAGES.WIZARD_SETUP_RUNNING);
        gate.hide();
      }
    };
    return { panel, setPhase };
  }
  async checkExternalAndAdvance(statusEl, nextBtn) {
    try {
      await this.plugin.saveSettings();
      this.plugin.api.setBaseUrl(this.plugin.settings.serverUrl);
      this.plugin.api.setToken(this.plugin.settings.manualToken || null);
      const result = await this.plugin.api.health();
      if (result.isErr()) throw result.error;
      statusEl.setText("");
      this.step = WIZARD_STEP.MODEL_PICKER;
      this.renderStep();
    } catch {
      statusEl.setText(MESSAGES.ERROR_COULD_NOT_CONNECT_EXT);
      nextBtn.disabled = false;
    }
  }
  /**
   * Build the shared download-progress panel used by steps 3–5. The panel
   * starts hidden; `activateProgressPanel` below flips it on once work
   * begins.
   */
  renderProgressPanel(step) {
    const progressEl = step.createDiv({ cls: "lilbee-wizard-progress" });
    progressEl.hide();
    const progressBar = progressEl.createDiv({ cls: "lilbee-progress-bar-container" });
    const progressFill = progressBar.createDiv({
      cls: "lilbee-progress-bar lilbee-wizard-progress-fill lilbee-progress-indeterminate"
    });
    const progressLabel = progressEl.createDiv({ cls: "lilbee-wizard-progress-label" });
    const footer = progressEl.createDiv({ cls: "lilbee-wizard-progress-footer" });
    footer.createDiv({
      cls: "lilbee-wizard-progress-hint",
      text: MESSAGES.WIZARD_PROGRESS_BACKGROUND
    });
    return { progressEl, progressFill, progressLabel };
  }
  /**
   * Update the progress fill: hands off from indeterminate to determinate
   * the first time a percentage comes in. Also sets the hero rail to the
   * "active" state so the step visually pulses like a Task Center row.
   */
  updateProgress(step, progressFill, pct) {
    const rail = step.querySelector(".lilbee-wizard-rail");
    rail?.classList.add("is-active");
    if (pct === void 0) return;
    progressFill.classList.remove("lilbee-progress-indeterminate");
    progressFill.style.width = `${pct}%`;
  }
  renderModelPicker() {
    const step = this.beginStep();
    this.renderStepHeader(step, MESSAGES.TITLE_PICK_MODEL);
    step.createEl("p", { text: MESSAGES.WIZARD_MODEL_HELP });
    const memGB = getSystemMemoryGB();
    if (memGB !== null) {
      step.createEl("p", {
        text: MESSAGES.WIZARD_SYSTEM_RAM.replace("{ram}", String(memGB)),
        cls: "lilbee-wizard-system-info"
      });
    }
    const modelsContainer = step.createDiv({ cls: "lilbee-wizard-models" });
    const statusEl = step.createDiv({ cls: "lilbee-wizard-status" });
    const { progressEl, progressFill, progressLabel } = this.renderProgressPanel(step);
    const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
    const backBtn = actions.createEl("button", { text: MESSAGES.BUTTON_BACK });
    backBtn.addEventListener("click", () => {
      this.pullController?.abort();
      this.back();
    });
    const skipBtn = actions.createEl("button", { text: MESSAGES.BUTTON_SKIP_SETUP });
    skipBtn.addEventListener("click", () => {
      this.pullController?.abort();
      this.skip();
    });
    const catalogBtn = actions.createEl("button", { text: MESSAGES.BUTTON_BROWSE_FULL_CATALOG });
    catalogBtn.addEventListener("click", () => {
      this.close();
      new CatalogModal(this.app, this.plugin, MODEL_TASK.CHAT, CATALOG_TAB.CHAT).open();
    });
    const downloadBtn = actions.createEl("button", { text: MESSAGES.BUTTON_DOWNLOAD_CONTINUE, cls: "mod-cta" });
    downloadBtn.addEventListener("click", () => {
      if (!this.selectedModel) {
        statusEl.setText(MESSAGES.WIZARD_SELECT_MODEL);
        return;
      }
      downloadBtn.disabled = true;
      statusEl.setText("");
      void this.pullSelectedModel(downloadBtn, progressEl, progressFill, progressLabel, statusEl, step);
    });
    void this.loadFeaturedModels(modelsContainer, memGB, statusEl);
  }
  async loadFeaturedModels(container, memGB, statusEl) {
    try {
      const result = await this.plugin.api.catalog({
        task: MODEL_TASK.CHAT,
        featured: true,
        sort: FILTERS.SORT.DOWNLOADS,
        limit: 40
      });
      if (result.isErr()) {
        this.featuredModels = [];
        return;
      }
      this.featuredModels = pickNativeChatModels(result.value.models);
    } catch {
      this.featuredModels = [];
      statusEl.setText(MESSAGES.ERROR_LOAD_MODELS);
      return;
    }
    const recommended = recommendedIndex(this.featuredModels, memGB);
    this.selectedModel = this.featuredModels[recommended] ?? null;
    this.renderSectionHeading(container, MESSAGES.LABEL_OUR_PICKS);
    const grid = container.createDiv({ cls: "lilbee-catalog-grid" });
    for (let i2 = 0; i2 < this.featuredModels.length; i2++) {
      const entry = this.featuredModels[i2];
      renderModelCard(grid, entry, {
        isActive: i2 === recommended,
        onClick: () => this.selectModel(grid, entry)
      });
    }
  }
  selectModel(grid, model) {
    this.selectedModel = model;
    for (const child of Array.from(grid.children)) {
      const el = child;
      if (el.dataset.repo === model.hf_repo) {
        el.classList.add("is-selected");
      } else {
        el.classList.remove("is-selected");
      }
    }
  }
  async pullSelectedModel(downloadBtn, progressEl, progressFill, progressLabel, statusEl, step) {
    if (!this.selectedModel) return;
    const model = this.selectedModel;
    progressEl.show();
    progressLabel.setText(MESSAGES.STATUS_DOWNLOADING_MODEL.replace("{model}", model.hf_repo));
    this.pullController = new AbortController();
    this.updateProgress(step, progressFill, void 0);
    try {
      for await (const event of this.plugin.api.pullModel(model.hf_repo, "native", this.pullController.signal)) {
        if (event.event === SSE_EVENT.PROGRESS) {
          const d = event.data;
          const pct = percentFromSse(d);
          if (pct !== void 0) {
            this.updateProgress(step, progressFill, pct);
            progressLabel.setText(
              MESSAGES.STATUS_DOWNLOADING_MODEL_PCT.replace("{model}", model.hf_repo).replace(
                "{pct}",
                String(pct)
              )
            );
          }
        } else if (event.event === SSE_EVENT.ERROR) {
          const d = event.data;
          const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
          new import_obsidian11.Notice(MESSAGES.ERROR_DOWNLOAD_FAILED);
          statusEl.setText(msg);
          break;
        }
      }
      const setResult = await this.plugin.api.setChatModel(model.hf_repo);
      if (setResult.isErr()) {
        new import_obsidian11.Notice(MESSAGES.ERROR_SET_MODEL.replace("{model}", model.display_name));
        statusEl.setText(setResult.error.message);
        progressEl.hide();
        downloadBtn.disabled = false;
        return;
      }
      this.plugin.activeModel = model.hf_repo;
      void this.plugin.fetchActiveModel();
      this.pulledModelName = model.display_name;
      this.step = WIZARD_STEP.EMBEDDING_PICKER;
      this.renderStep();
    } catch (err3) {
      if (err3 instanceof Error && err3.name === ERROR_NAME.ABORT_ERROR) {
        new import_obsidian11.Notice(MESSAGES.NOTICE_DOWNLOAD_CANCELLED);
      } else if (err3 instanceof SessionTokenError) {
        const msg = sessionTokenInvalidMessage(this.plugin.settings.serverMode);
        new import_obsidian11.Notice(msg);
        statusEl.setText(msg);
      } else {
        statusEl.setText(MESSAGES.ERROR_DOWNLOAD_FAILED);
      }
      progressEl.hide();
      downloadBtn.disabled = false;
    } finally {
      this.pullController = null;
    }
  }
  renderEmbeddingPicker() {
    const step = this.beginStep();
    this.renderStepHeader(step, MESSAGES.TITLE_PICK_EMBEDDING);
    step.createEl("p", { text: MESSAGES.WIZARD_EMBEDDING_HELP });
    const modelsContainer = step.createDiv({ cls: "lilbee-wizard-models" });
    const statusEl = step.createDiv({ cls: "lilbee-wizard-status" });
    const { progressEl, progressFill, progressLabel } = this.renderProgressPanel(step);
    const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
    const backBtn = actions.createEl("button", { text: MESSAGES.BUTTON_BACK });
    backBtn.addEventListener("click", () => {
      this.pullController?.abort();
      this.back();
    });
    const skipBtn = actions.createEl("button", { text: MESSAGES.BUTTON_SKIP_SETUP });
    skipBtn.addEventListener("click", () => {
      this.pullController?.abort();
      this.skip();
    });
    const downloadBtn = actions.createEl("button", { text: MESSAGES.BUTTON_DOWNLOAD_CONTINUE, cls: "mod-cta" });
    downloadBtn.addEventListener("click", () => {
      if (!this.selectedEmbedding) {
        this.step = WIZARD_STEP.SYNC;
        this.renderStep();
        return;
      }
      if (this.selectedEmbedding.installed) {
        const ref = this.selectedEmbedding.hf_repo;
        const label = this.selectedEmbedding.display_name;
        void (async () => {
          const result = await this.plugin.api.setEmbeddingModel(ref);
          if (result.isErr()) {
            new import_obsidian11.Notice(MESSAGES.ERROR_SET_MODEL.replace("{model}", label));
            return;
          }
          this.step = WIZARD_STEP.SYNC;
          this.renderStep();
        })();
        return;
      }
      downloadBtn.disabled = true;
      statusEl.setText("");
      void this.pullEmbeddingModel(downloadBtn, progressEl, progressFill, progressLabel, statusEl, step);
    });
    void this.loadEmbeddingModels(modelsContainer, statusEl);
  }
  async loadEmbeddingModels(container, statusEl) {
    try {
      const result = await this.plugin.api.catalog({
        task: MODEL_TASK.EMBEDDING,
        featured: true,
        sort: FILTERS.SORT.DOWNLOADS,
        limit: 20
      });
      if (result.isErr()) {
        this.embeddingModels = [];
        return;
      }
      this.embeddingModels = result.value.models.slice(0, MAX_FEATURED_PICKS);
    } catch {
      this.embeddingModels = [];
      statusEl.setText(MESSAGES.ERROR_LOAD_MODELS);
      return;
    }
    const recommended = this.embeddingModels.findIndex((m) => m.hf_repo.toLowerCase().includes("nomic-embed-text"));
    const defaultIdx = recommended >= 0 ? recommended : 0;
    this.selectedEmbedding = this.embeddingModels[defaultIdx] ?? null;
    this.renderSectionHeading(container, MESSAGES.WIZARD_EMBEDDING_RECOMMENDED);
    const grid = container.createDiv({ cls: "lilbee-catalog-grid" });
    for (let i2 = 0; i2 < this.embeddingModels.length; i2++) {
      const entry = this.embeddingModels[i2];
      renderModelCard(grid, entry, {
        isActive: i2 === defaultIdx,
        onClick: () => this.selectEmbedding(grid, entry)
      });
    }
  }
  selectEmbedding(grid, model) {
    this.selectedEmbedding = model;
    for (const child of Array.from(grid.children)) {
      const el = child;
      if (el.dataset.repo === model.hf_repo) {
        el.classList.add("is-selected");
      } else {
        el.classList.remove("is-selected");
      }
    }
  }
  async pullEmbeddingModel(downloadBtn, progressEl, progressFill, progressLabel, statusEl, step) {
    if (!this.selectedEmbedding) return;
    const model = this.selectedEmbedding;
    progressEl.show();
    progressLabel.setText(MESSAGES.STATUS_DOWNLOADING_MODEL.replace("{model}", model.hf_repo));
    this.pullController = new AbortController();
    this.updateProgress(step, progressFill, void 0);
    try {
      for await (const event of this.plugin.api.pullModel(model.hf_repo, "native", this.pullController.signal)) {
        if (event.event === SSE_EVENT.PROGRESS) {
          const d = event.data;
          const pct = percentFromSse(d);
          if (pct !== void 0) {
            this.updateProgress(step, progressFill, pct);
            progressLabel.setText(
              MESSAGES.STATUS_DOWNLOADING_MODEL_PCT.replace("{model}", model.hf_repo).replace(
                "{pct}",
                String(pct)
              )
            );
          }
        } else if (event.event === SSE_EVENT.ERROR) {
          const d = event.data;
          const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
          new import_obsidian11.Notice(MESSAGES.ERROR_DOWNLOAD_FAILED);
          statusEl.setText(msg);
          break;
        }
      }
      const setResult = await this.plugin.api.setEmbeddingModel(model.hf_repo);
      if (setResult.isErr()) {
        new import_obsidian11.Notice(MESSAGES.ERROR_SET_MODEL.replace("{model}", model.display_name));
        statusEl.setText(setResult.error.message);
        progressEl.hide();
        downloadBtn.disabled = false;
        return;
      }
      this.step = WIZARD_STEP.SYNC;
      this.renderStep();
    } catch (err3) {
      if (err3 instanceof Error && err3.name === ERROR_NAME.ABORT_ERROR) {
        new import_obsidian11.Notice(MESSAGES.NOTICE_DOWNLOAD_CANCELLED);
      } else if (err3 instanceof SessionTokenError) {
        const msg = sessionTokenInvalidMessage(this.plugin.settings.serverMode);
        new import_obsidian11.Notice(msg);
        statusEl.setText(msg);
      } else {
        statusEl.setText(MESSAGES.ERROR_DOWNLOAD_FAILED);
      }
      progressEl.hide();
      downloadBtn.disabled = false;
    } finally {
      this.pullController = null;
    }
  }
  renderSync() {
    const step = this.beginStep();
    this.renderStepHeader(step, MESSAGES.TITLE_INDEX_VAULT);
    step.createEl("p", { text: MESSAGES.WIZARD_SYNC_HELP });
    const { progressEl, progressFill, progressLabel } = this.renderProgressPanel(step);
    progressEl.show();
    progressLabel.setText(MESSAGES.WIZARD_STATUS_STARTING);
    this.updateProgress(step, progressFill, void 0);
    const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
    const backBtn = actions.createEl("button", { text: MESSAGES.BUTTON_BACK });
    backBtn.addEventListener("click", () => {
      this.syncController?.abort();
      this.back();
    });
    const skipBtn = actions.createEl("button", { text: MESSAGES.BUTTON_SKIP_SETUP });
    skipBtn.addEventListener("click", () => {
      this.syncController?.abort();
      this.skip();
    });
    void this.runSync(progressFill, progressLabel, step);
  }
  async runSync(progressFill, progressLabel, step) {
    this.syncController = new AbortController();
    try {
      let lastEvent = null;
      for await (const event of this.plugin.api.syncStream(this.syncController.signal)) {
        if (event.event === SSE_EVENT.FILE_START) {
          const d = event.data;
          const pct = d.total_files > 0 ? Math.round(d.current_file / d.total_files * 100) : 0;
          this.updateProgress(step, progressFill, pct);
          progressLabel.setText(
            MESSAGES.STATUS_PROCESSING_FILES.replace("{current}", String(d.current_file)).replace(
              "{total}",
              String(d.total_files)
            )
          );
        } else if (event.event === SSE_EVENT.BATCH_PROGRESS) {
          const d = event.data;
          this.updateProgress(step, progressFill, Math.round(d.current / d.total * 100));
          progressLabel.setText(MESSAGES.STATUS_TASK_BATCH(d.current, d.total, d.file, d.status));
        }
        if (event.event === SSE_EVENT.EMBED) {
          const d = event.data;
          if (d.file) {
            progressLabel.setText(MESSAGES.STATUS_INDEXING.replace("{file}", d.file));
          }
        } else if (event.event === SSE_EVENT.ERROR) {
          const d = event.data;
          const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
          progressLabel.setText(msg);
          throw new Error(msg);
        }
        lastEvent = event;
      }
      if (lastEvent?.event === SSE_EVENT.DONE) {
        this.syncResult = lastEvent.data;
      }
      this.updateProgress(step, progressFill, 100);
      progressLabel.setText(MESSAGES.STATUS_DONE);
      this.step = WIZARD_STEP.WIKI;
      this.renderStep();
    } catch (err3) {
      if (err3 instanceof Error && err3.name === ERROR_NAME.ABORT_ERROR) {
        new import_obsidian11.Notice(MESSAGES.NOTICE_INDEXING_CANCELLED);
      } else if (err3 instanceof SessionTokenError) {
        const msg = sessionTokenInvalidMessage(this.plugin.settings.serverMode);
        new import_obsidian11.Notice(msg);
        progressLabel.setText(msg);
      } else {
        progressLabel.setText(MESSAGES.ERROR_INDEXING_FAILED);
      }
    } finally {
      this.syncController = null;
    }
  }
  renderWiki() {
    const step = this.beginStep();
    this.renderStepHeader(step, MESSAGES.WIZARD_WIKI_TITLE);
    step.createEl("p", { text: MESSAGES.WIZARD_WIKI_DESC });
    const caveats = step.createDiv({ cls: "lilbee-wizard-wiki-caveats" });
    this.renderSectionHeading(caveats, MESSAGES.WIZARD_WIKI_CAVEATS_HEADING);
    caveats.createEl("p", {
      text: MESSAGES.WIZARD_WIKI_CAVEATS_INTRO,
      cls: "lilbee-wizard-wiki-caveats-intro"
    });
    const bullets = caveats.createEl("ul", { cls: "lilbee-wizard-wiki-caveats-bullets" });
    bullets.createEl("li", { text: MESSAGES.WIZARD_WIKI_CAVEAT_QUALITY });
    bullets.createEl("li", { text: MESSAGES.WIZARD_WIKI_CAVEAT_COST });
    const tradeoffs = step.createEl("details", { cls: "lilbee-wizard-wiki-tradeoffs" });
    tradeoffs.createEl("summary", { text: MESSAGES.WIZARD_WIKI_TRADEOFFS_LABEL });
    const prosSection = tradeoffs.createDiv({ cls: "lilbee-wizard-wiki-section" });
    this.renderSectionHeading(prosSection, MESSAGES.WIZARD_WIKI_PROS_HEADING);
    const prosList = prosSection.createEl("ul");
    prosList.createEl("li", { text: MESSAGES.WIZARD_WIKI_PRO_SUMMARIES });
    prosList.createEl("li", { text: MESSAGES.WIZARD_WIKI_PRO_CROSSREFS });
    prosList.createEl("li", { text: MESSAGES.WIZARD_WIKI_PRO_ANSWERS });
    const consSection = tradeoffs.createDiv({ cls: "lilbee-wizard-wiki-section" });
    this.renderSectionHeading(consSection, MESSAGES.WIZARD_WIKI_CONS_HEADING);
    const consList = consSection.createEl("ul");
    consList.createEl("li", { text: MESSAGES.WIZARD_WIKI_CON_TOKENS });
    consList.createEl("li", { text: MESSAGES.WIZARD_WIKI_CON_ACCURACY });
    consList.createEl("li", { text: MESSAGES.WIZARD_WIKI_CON_SEARCH });
    consList.createEl("li", { text: MESSAGES.WIZARD_WIKI_CON_COMPLEXITY });
    let wikiEnabled = this.plugin.settings.wikiEnabled ?? false;
    const enableOption = step.createDiv({
      cls: `lilbee-wizard-model-option${wikiEnabled ? " selected" : ""}`
    });
    enableOption.createEl("strong", { text: MESSAGES.WIZARD_WIKI_ENABLE });
    enableOption.createEl("p", { text: MESSAGES.WIZARD_WIKI_ENABLE_DESC });
    enableOption.setAttribute("aria-label", MESSAGES.TOOLTIP_WIZARD_WIKI_ENABLE);
    const disableOption = step.createDiv({
      cls: `lilbee-wizard-model-option${!wikiEnabled ? " selected" : ""}`
    });
    disableOption.createEl("strong", { text: MESSAGES.WIZARD_WIKI_DISABLE });
    disableOption.createEl("p", { text: MESSAGES.WIZARD_WIKI_DISABLE_DESC });
    enableOption.addEventListener("click", () => {
      wikiEnabled = true;
      enableOption.classList.add("selected");
      disableOption.classList.remove("selected");
    });
    disableOption.addEventListener("click", () => {
      wikiEnabled = false;
      disableOption.classList.add("selected");
      enableOption.classList.remove("selected");
    });
    const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
    const backBtn = actions.createEl("button", { text: MESSAGES.BUTTON_BACK });
    backBtn.addEventListener("click", () => this.back());
    const skipBtn = actions.createEl("button", { text: MESSAGES.BUTTON_SKIP_SETUP });
    skipBtn.addEventListener("click", () => this.skip());
    const nextBtn = actions.createEl("button", { text: MESSAGES.BUTTON_NEXT, cls: "mod-cta" });
    nextBtn.addEventListener("click", () => {
      this.plugin.settings.wikiEnabled = wikiEnabled;
      void this.plugin.saveSettings();
      this.next();
    });
  }
  renderDone() {
    const step = this.beginStep();
    this.renderStepHeader(step, MESSAGES.TITLE_ALL_SET);
    const summary = step.createDiv({ cls: "lilbee-wizard-summary-card" });
    const summaryBody = summary.createDiv({ cls: "lilbee-wizard-summary-body" });
    this.renderSectionHeading(summaryBody, MESSAGES.WIZARD_SUMMARY_HEADING);
    const stats = summaryBody.createDiv({ cls: "lilbee-wizard-summary-stats" });
    if (this.pulledModelName) {
      stats.createSpan({
        cls: "lilbee-wizard-summary-stat",
        text: MESSAGES.WIZARD_SUMMARY_MODEL.replace("{model}", this.pulledModelName)
      });
    }
    if (this.syncResult) {
      const total = this.syncResult.added.length + this.syncResult.updated.length + this.syncResult.unchanged;
      const chunks = this.syncResult.added.length + this.syncResult.updated.length;
      stats.createSpan({
        cls: "lilbee-wizard-summary-stat",
        text: MESSAGES.WIZARD_SUMMARY_FILES.replace("{count}", String(total))
      });
      if (chunks > 0) {
        stats.createSpan({
          cls: "lilbee-wizard-summary-stat",
          text: MESSAGES.WIZARD_SUMMARY_PROCESSED.replace("{count}", String(chunks))
        });
      }
    }
    this.renderSectionHeading(step, MESSAGES.WIZARD_TIPS);
    const tips = step.createDiv({ cls: "lilbee-wizard-tips" });
    const tipData = [
      ["\u{1F4AC}", MESSAGES.WIZARD_TIP_CHAT],
      ["\u{1F50D}", MESSAGES.WIZARD_TIP_SEARCH],
      ["\u{1F4C4}", MESSAGES.WIZARD_TIP_DRAG]
    ];
    for (const [icon, text] of tipData) {
      const tip = tips.createDiv({ cls: "lilbee-wizard-tip" });
      tip.createSpan({ cls: "lilbee-wizard-tip-icon", text: icon });
      tip.createSpan({ text });
    }
    step.createEl("p", { text: MESSAGES.WIZARD_CHANGE_SETTINGS, cls: "lilbee-wizard-hint" });
    const actions = step.createDiv({ cls: "lilbee-wizard-actions" });
    const openChatBtn = actions.createEl("button", { text: MESSAGES.BUTTON_OPEN_CHAT, cls: "mod-cta" });
    openChatBtn.addEventListener("click", () => void this.complete());
  }
  next() {
    if (this.step === WIZARD_STEP.WELCOME) {
      const serverReady = this.plugin.serverManager?.state === SERVER_STATE.READY || this.plugin.settings.serverMode === SERVER_MODE.EXTERNAL;
      this.step = serverReady ? WIZARD_STEP.MODEL_PICKER : WIZARD_STEP.SERVER_MODE;
    } else {
      this.step++;
    }
    this.renderStep();
  }
  back() {
    if (this.step === WIZARD_STEP.MODEL_PICKER) {
      this.step = WIZARD_STEP.SERVER_MODE;
    } else if (this.step === WIZARD_STEP.EMBEDDING_PICKER) {
      this.step = WIZARD_STEP.MODEL_PICKER;
    } else {
      this.step = Math.max(0, this.step - 1);
    }
    this.renderStep();
  }
  skip() {
    this.close();
  }
  async complete() {
    this.plugin.settings.setupCompleted = true;
    await this.plugin.saveSettings();
    this.close();
    void this.plugin.activateChatView();
    closeSettings(this.app);
  }
};

// src/views/uninstall-modal.ts
var import_obsidian12 = require("obsidian");
var TARGET_LABELS = {
  [UNINSTALL_TARGET.BINARY]: MESSAGES.LABEL_UNINSTALL_BINARY,
  [UNINSTALL_TARGET.MODELS]: MESSAGES.LABEL_UNINSTALL_MODELS,
  [UNINSTALL_TARGET.INDEX]: MESSAGES.LABEL_UNINSTALL_INDEX
};
var UninstallModal = class extends import_obsidian12.Modal {
  plan;
  _resolve = null;
  decided = false;
  result;
  constructor(app, plan) {
    super(app);
    this.plan = plan;
    this.result = new Promise((resolve2) => {
      this._resolve = resolve2;
    });
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: MESSAGES.CONFIRM_UNINSTALL_TITLE });
    contentEl.createEl("p", { text: MESSAGES.CONFIRM_UNINSTALL_BODY });
    const ledger = contentEl.createDiv({ cls: "lilbee-uninstall-ledger" });
    for (const target2 of this.plan.targets) {
      this.appendRow(
        ledger,
        MESSAGES.LABEL_UNINSTALL_DELETE_TAG,
        TARGET_LABELS[target2.kind],
        formatDiskSize(target2.bytes)
      );
    }
    const keep = this.appendRow(
      ledger,
      MESSAGES.LABEL_UNINSTALL_KEEP_TAG,
      MESSAGES.LABEL_UNINSTALL_KEEP,
      MESSAGES.LABEL_UNINSTALL_KEEP_VALUE
    );
    keep.addClass("is-keep");
    const actions = contentEl.createDiv({ cls: "lilbee-confirm-actions" });
    const cancelBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CANCEL });
    cancelBtn.addEventListener("click", () => this.decide(false));
    const uninstallBtn = actions.createEl("button", { text: MESSAGES.BUTTON_UNINSTALL, cls: "mod-warning" });
    uninstallBtn.addEventListener("click", () => this.decide(true));
  }
  appendRow(parent, tag, label, value) {
    const row = parent.createDiv({ cls: "lilbee-uninstall-row" });
    row.createSpan({ cls: "lilbee-uninstall-tag", text: tag });
    row.createSpan({ cls: "lilbee-uninstall-label", text: label });
    row.createSpan({ cls: "lilbee-uninstall-size", text: value });
    return row;
  }
  onClose() {
    this.decide(false);
  }
  decide(confirmed) {
    if (this.decided) return;
    this.decided = true;
    if (this._resolve) {
      const resolve2 = this._resolve;
      this._resolve = null;
      resolve2(confirmed);
    }
    this.close();
  }
};

// src/settings.ts
var LIBERA_LILBEE_URL = "https://web.libera.chat/#lilbee";
var CHECK_TIMEOUT_MS = 5e3;
var RELEASES_CACHE_TTL_MS = 10 * 60 * 1e3;
var CLS_MODELS_CONTAINER = "lilbee-models-container";
var RERANKER_DISABLED_KEY = "";
var VISION_DISABLED_KEY = "";
var RERANK_CANDIDATES_MIN = 1;
var RERANK_CANDIDATES_MAX = 100;
var SEPARATOR_KEY = "__separator__";
var SEPARATOR_LABEL = "\u2500\u2500 Other... \u2500\u2500";
var ICON_RESET = "rotate-ccw";
var CREDENTIAL_FIELDS = /* @__PURE__ */ new Set([
  "openai_api_key",
  "anthropic_api_key",
  "gemini_api_key",
  "hf_token",
  "manual_session_token"
]);
function showPhase(progress, message, percent) {
  progress.phase.setText(message);
  if (percent !== void 0) setDeterminateProgress(progress.fill, percent);
}
var LilbeeSettingTab = class extends import_obsidian13.PluginSettingTab {
  plugin;
  /** Total bytes of the shared install, set by the storage report each render. */
  storageTotalBytes = 0;
  // Textareas live here too: the prompt fields are multi-line but are filled
  // from a plain string like every other input, and both element types carry
  // the value and placeholder this map is read for.
  serverConfigInputs = /* @__PURE__ */ new Map();
  serverConfigToggles = /* @__PURE__ */ new Map();
  memoryToggles = /* @__PURE__ */ new Map();
  serverConfigTextAreas = /* @__PURE__ */ new Map();
  serverConfigDropdowns = /* @__PURE__ */ new Map();
  // Rows hidden until loadServerDefaults sees a defined value for the matching cfg key.
  serverConfigHideableEls = /* @__PURE__ */ new Map();
  configDefaults = {};
  // Guards programmatic toggle.setValue() calls from echoing back to the server.
  suppressToggleChanges = false;
  chatModeSettingEl = null;
  chatModeDropdown = null;
  chatModeSelectEl = null;
  apiKeysContainerEl = null;
  crawlingContainerEl = null;
  wikiContainerEl = null;
  /** Last successful release-list fetch; failures are not cached, so a retry always refetches. */
  releasesCache = null;
  /** Detected agent CLIs; null until the first probe lands or after it fails. */
  agentDetections = null;
  agentBodyEl = null;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    this.render();
  }
  render() {
    const { containerEl } = this;
    containerEl.empty();
    this.serverConfigInputs.clear();
    this.serverConfigToggles.clear();
    this.serverConfigTextAreas.clear();
    this.serverConfigDropdowns.clear();
    this.serverConfigHideableEls.clear();
    const filterInput = containerEl.createEl("input", {
      cls: "lilbee-settings-filter",
      placeholder: MESSAGES.PLACEHOLDER_FILTER_SETTINGS,
      attr: { type: "text" }
    });
    filterInput.addEventListener("input", () => {
      this.filterSettings(containerEl, filterInput.value);
    });
    this.renderBugFeedback(containerEl);
    this.renderConnectionSettings(containerEl);
    this.renderModelsSection(containerEl);
    this.renderChatSettings(containerEl);
    this.renderSearchRetrievalSettings(containerEl);
    this.renderGenerationSettings(containerEl);
    this.renderMemorySection(containerEl);
    this.renderRetrievalAdvanced(containerEl);
    this.renderIngestSettings(containerEl);
    this.renderWorkerPoolSettings(containerEl);
    this.crawlingContainerEl = containerEl.createDiv();
    this.renderCrawlingSettings(this.crawlingContainerEl);
    this.wikiContainerEl = containerEl.createDiv();
    this.renderWikiSettings(this.wikiContainerEl);
    this.renderAgentIntegration(containerEl);
    this.renderDiagnostics(containerEl);
    this.renderAdvancedSettings(containerEl);
    this.renderFleetSettings(containerEl);
    if (this.plugin.settings.serverMode === SERVER_MODE.MANAGED && this.hasManagedServer()) {
      this.renderUninstallSection(containerEl, this.storageTotalBytes);
    }
    this.loadServerDefaults();
    this.loadConfigDefaults();
    void this.applyCapabilityGating();
  }
  async applyCapabilityGating() {
    const [apiKeys, crawling, wiki] = await Promise.all([
      this.plugin.api.getCapability(CAPABILITY.API_KEYS),
      this.plugin.api.getCapability(CAPABILITY.CRAWLING),
      this.plugin.api.getCapability(CAPABILITY.WIKI)
    ]);
    if (!apiKeys && this.apiKeysContainerEl) this.apiKeysContainerEl.hide();
    if (!crawling && this.crawlingContainerEl) this.crawlingContainerEl.hide();
    if (!wiki && this.wikiContainerEl) this.wikiContainerEl.hide();
  }
  filterSettings(containerEl, query) {
    const term = query.trim().toLowerCase();
    const matches = (item) => {
      const name = item.querySelector(".setting-item-name")?.textContent?.toLowerCase() ?? "";
      const desc = item.querySelector(".setting-item-description")?.textContent?.toLowerCase() ?? "";
      return !term || name.includes(term) || desc.includes(term);
    };
    for (const item of Array.from(containerEl.querySelectorAll(".setting-item"))) {
      item.style.display = matches(item) ? "" : "none";
    }
    const wrappers = containerEl.querySelectorAll(
      ".lilbee-settings-section, .lilbee-models-container, .lilbee-chat-container, .lilbee-embedding-container, .lilbee-vision-container, .lilbee-reranker-container, .lilbee-model-section"
    );
    for (const wrapper of Array.from(wrappers)) {
      const items = Array.from(wrapper.querySelectorAll(".setting-item"));
      const anyVisible = items.some((i2) => i2.style.display !== "none");
      wrapper.style.display = anyVisible || !term ? "" : "none";
      if (term && anyVisible && wrapper.tagName === "DETAILS") {
        wrapper.setAttribute("open", "");
      }
    }
  }
  renderConnectionSettings(containerEl) {
    const modeSetting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SERVER_MODE).setDesc(MESSAGES.DESC_SERVER_MODE).addDropdown(
      (dropdown) => dropdown.addOption(SERVER_MODE.MANAGED, MESSAGES.DESC_MANAGED_BUILTIN).addOption(SERVER_MODE.EXTERNAL, MESSAGES.DESC_EXTERNAL_MANUAL).setValue(this.plugin.settings.serverMode).onChange(async (value) => {
        this.plugin.settings.serverMode = value;
        await this.plugin.saveSettings();
        this.render();
      })
    );
    this.appendLocalResetAffordance(modeSetting, "serverMode", MESSAGES.LABEL_SERVER_MODE);
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SETUP_WIZARD).setDesc(MESSAGES.DESC_SETUP_WIZARD).addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_RUN_SETUP_WIZARD).onClick(() => {
        new SetupWizard(this.app, this.plugin).open();
      })
    );
    if (this.plugin.settings.serverMode === SERVER_MODE.MANAGED) {
      this.renderManagedSettings(containerEl);
    } else {
      this.renderExternalSettings(containerEl);
    }
  }
  /**
   * A binary on disk that the plugin is still allowed to run. An uninstalled
   * server never starts, even if a binary was put back by hand, until an
   * explicit install clears the flag.
   */
  renderAgentIntegration(containerEl) {
    const section = containerEl.createDiv({ cls: "lilbee-settings-section lilbee-agent-section" });
    new import_obsidian13.Setting(section).setName(MESSAGES.LABEL_AGENT_SECTION).setHeading().setDesc(MESSAGES.DESC_AGENT_SECTION);
    this.agentBodyEl = section.createDiv({ cls: "lilbee-agent-body" });
    void this.loadAgentDetections();
  }
  /** Probe for agent CLIs, reusing the last result unless the user asked to rescan. */
  async loadAgentDetections(force = false) {
    if (this.agentDetections === null || force) {
      const index = await this.plugin.api.getAgentConfigIndex();
      this.agentDetections = index.isOk() ? index.value.clients : null;
    }
    this.renderAgentBody();
  }
  renderAgentBody() {
    const body = this.agentBodyEl;
    if (!body) return;
    body.empty();
    const detections = this.agentDetections;
    if (detections === null) {
      body.createEl("p", { cls: "setting-item-description", text: MESSAGES.AGENT_DETECT_UNAVAILABLE });
      this.addRescanButton(body);
      return;
    }
    const installed = detections.filter((d) => d.cli_detected).map((d) => d.client);
    this.renderAgentChoice(body, installed);
    this.renderSupportedAgents(body);
    const selected = this.plugin.settings.agentIntegration.agent;
    if (selected === AGENT_SELECTION.NONE) return;
    this.renderAgentKeepFresh(body);
    this.renderAgentModelRow(body);
    if (selected === AGENT_CLIENT.OPENCODE) this.renderClaudianRow(body);
    this.renderAgentStatus(body, selected);
  }
  addRescanButton(parent, setting) {
    const target2 = setting ?? new import_obsidian13.Setting(parent).setName(MESSAGES.LABEL_AGENT_SUPPORTED);
    target2.addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_AGENT_RESCAN).onClick(() => {
        void this.loadAgentDetections(true);
      })
    );
  }
  /** A plain links row: the projects a user installs to get a coding agent. */
  renderSupportedAgents(body) {
    const setting = new import_obsidian13.Setting(body).setName(MESSAGES.LABEL_AGENT_SUPPORTED);
    const links = setting.descEl.createSpan({ cls: "lilbee-agent-links" });
    AGENT_LINKS.forEach((link, i2) => {
      if (i2 > 0) links.appendText(" \xB7 ");
      renderExternalLink(links, link.label, link.url);
    });
    this.addRescanButton(body, setting);
  }
  /** The dropdown lists only installed agents, so what shows is what you can pick. */
  renderAgentChoice(body, installed) {
    new import_obsidian13.Setting(body).setName(MESSAGES.LABEL_AGENT_CHOICE).setDesc(MESSAGES.DESC_AGENT_CHOICE).addDropdown((dropdown) => {
      dropdown.addOption(AGENT_SELECTION.NONE, MESSAGES.AGENT_OPTION_NONE);
      for (const client of installed) {
        dropdown.addOption(client, AGENT_LABELS[client]);
      }
      dropdown.setValue(this.plugin.settings.agentIntegration.agent);
      dropdown.onChange(async (value) => {
        const agent = value;
        this.plugin.settings.agentIntegration.agent = agent;
        this.plugin.settings.agentIntegration.pickerShown = true;
        await this.plugin.persistAgentIntegration();
        if (agent !== AGENT_SELECTION.NONE) await this.plugin.applyAgentWiring(agent);
        this.renderAgentBody();
      });
    });
  }
  renderAgentKeepFresh(body) {
    new import_obsidian13.Setting(body).setName(MESSAGES.LABEL_AGENT_KEEP_FRESH).setDesc(MESSAGES.DESC_AGENT_KEEP_FRESH).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.agentIntegration.keepConfigFresh);
      toggle.onChange(async (value) => {
        this.plugin.settings.agentIntegration.keepConfigFresh = value;
        await this.plugin.persistAgentIntegration();
      });
    });
  }
  /** The agent runs on lilbee's chat model, so this row drives the same selection. */
  renderAgentModelRow(body) {
    const setting = new import_obsidian13.Setting(body).setName(MESSAGES.LABEL_AGENT_MODEL).setDesc(displayLabelForRef(this.plugin.activeModel) || MESSAGES.LABEL_NOT_SET).addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_AGENT_CHANGE_MODEL).onClick(() => {
        new ModelPickerModal(this.app, this.plugin, MODEL_TASK.CHAT).open();
      })
    );
    void this.renderAgentContext(setting, body);
  }
  async renderAgentContext(setting, body) {
    const health = await this.plugin.api.health();
    const ctx = health.isOk() ? health.value.chat_ctx : null;
    if (typeof ctx !== "number") return;
    const pill = createSpan({
      cls: `lilbee-key-status-pill ${PILL_CLS.CONTEXT}`,
      text: MESSAGES.AGENT_CONTEXT_BADGE(ctx)
    });
    setting.controlEl.prepend(pill);
    if (ctx < AGENT_MIN_CONTEXT_TOKENS) {
      body.createDiv({
        cls: "lilbee-agent-note setting-item-description is-warning",
        text: MESSAGES.AGENT_CONTEXT_WARNING
      });
    }
  }
  renderClaudianRow(body) {
    const setting = new import_obsidian13.Setting(body).setName(MESSAGES.LABEL_AGENT_CLAUDIAN);
    if (!isClaudianInstalled(this.app)) {
      setting.setDesc(MESSAGES.DESC_AGENT_CLAUDIAN_MISSING);
      return;
    }
    const skipped = this.plugin.lastAgentWrite?.claudian === CLAUDIAN_OUTCOME.SKIPPED;
    setting.setDesc(skipped ? MESSAGES.DESC_AGENT_CLAUDIAN_SKIPPED : MESSAGES.DESC_AGENT_CLAUDIAN_CONFIGURED);
    if (!skipped) {
      setting.controlEl.createSpan({
        cls: `lilbee-key-status-pill ${KEY_STATUS_PILL_CLASS.READY}`,
        text: MESSAGES.PILL_AGENT_CLAUDIAN_CONFIGURED
      });
    }
    setting.addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_OPEN_CLAUDIAN).onClick(() => {
        openPluginSettingsById(this.app, CLAUDIAN_PLUGIN_ID);
      })
    );
  }
  renderAgentStatus(body, agent) {
    const text = agent === AGENT_CLIENT.HERMES ? MESSAGES.AGENT_STATUS_GLOBAL : this.plugin.lastAgentWrite === null ? MESSAGES.AGENT_STATUS_PENDING : MESSAGES.AGENT_STATUS_CONNECTED;
    const status = body.createDiv({ cls: "lilbee-agent-status setting-item-description" });
    status.createSpan({ cls: "lilbee-agent-status-dot" });
    status.createSpan({ text });
    if (agent === AGENT_CLIENT.HERMES) this.renderHermesConfigBlock(body);
  }
  /** hermes keeps one global config, so lilbee offers the block rather than writing it. */
  renderHermesConfigBlock(body) {
    const setting = new import_obsidian13.Setting(body).setName(MESSAGES.LABEL_AGENT_COPY_CONFIG);
    const block = body.createEl("pre", { cls: "lilbee-agent-config-block" });
    void this.plugin.api.getAgentConfig(AGENT_CLIENT.HERMES).then((result) => {
      const content = result.isOk() ? result.value.content ?? "" : "";
      block.setText(content);
      setting.addButton(
        (btn) => btn.setButtonText(MESSAGES.BUTTON_AGENT_COPY).onClick(() => {
          void navigator.clipboard.writeText(content);
          new import_obsidian13.Notice(MESSAGES.NOTICE_AGENT_COPIED);
        })
      );
    });
  }
  hasManagedServer() {
    return this.plugin.isServerInstalled() && !this.plugin.isServerUninstalled();
  }
  renderManagedSettings(containerEl) {
    if (!this.hasManagedServer()) {
      this.renderInstallServer(containerEl);
      this.renderSharedRootSetting(containerEl);
      return;
    }
    const statusSetting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SERVER_STATUS).setDesc(MESSAGES.DESC_SERVER_STATUS_CURRENT);
    const statusEl = statusSetting.settingEl.createDiv({ cls: "lilbee-server-status" });
    const dot = statusEl.createDiv({ cls: "lilbee-server-dot" });
    const stateText = statusEl.createSpan();
    const serverState = this.plugin.serverManager?.state ?? SERVER_STATE.STOPPED;
    stateText.setText(serverState);
    dot.classList.add(`is-${serverState}`);
    const controlSetting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SERVER_CONTROLS).setDesc(MESSAGES.DESC_SERVER_CONTROLS_START_STOP);
    if (serverState === SERVER_STATE.STOPPED || serverState === SERVER_STATE.ERROR) {
      controlSetting.addButton(
        (btn) => btn.setButtonText(MESSAGES.BUTTON_START).onClick(async () => {
          this.plugin.journal.lifecycle("start requested from the settings tab");
          await this.plugin.startManagedServer();
          this.render();
        })
      );
    }
    if (serverState === SERVER_STATE.READY || serverState === SERVER_STATE.STARTING) {
      controlSetting.addButton(
        (btn) => btn.setButtonText(MESSAGES.BUTTON_STOP).onClick(async () => {
          this.plugin.journal.lifecycle("stop requested from the settings tab");
          await this.plugin.serverManager?.stop();
          this.render();
        })
      );
    }
    if (serverState === SERVER_STATE.READY) {
      controlSetting.addButton(
        (btn) => btn.setButtonText(MESSAGES.BUTTON_RESTART).onClick(async () => {
          this.plugin.journal.lifecycle("restart requested from the settings tab");
          try {
            await this.plugin.serverManager?.restart();
          } catch (err3) {
            new import_obsidian13.Notice(errorMessage(err3, MESSAGES.ERROR_START_SERVER));
          }
          this.render();
        })
      );
    }
    this.renderSharedRootSetting(containerEl);
    this.renderAdoptDataDir(containerEl);
    this.renderStorageReport(containerEl);
    this.renderVersionSetting(containerEl);
    this.renderAutoUpdateToggle(containerEl);
    this.renderDevBuildsToggle(containerEl);
  }
  renderAutoUpdateToggle(containerEl) {
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SERVER_AUTO_UPDATE).setDesc(MESSAGES.DESC_SERVER_AUTO_UPDATE).addToggle(
      (toggle) => toggle.setValue(this.plugin.isServerAutoUpdateEnabled()).onChange((value) => {
        this.plugin.setServerAutoUpdate(value);
      })
    );
  }
  /**
   * One control for upgrade, downgrade, and reinstall. The dropdown lists
   * recent releases newest-first; the button names what the selection does.
   */
  renderVersionSetting(containerEl) {
    const installed = this.plugin.getSharedLilbeeVersion();
    const setting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SERVER_VERSION).setDesc(MESSAGES.DESC_SERVER_VERSION_LOADING);
    setting.settingEl.setAttribute("aria-label", MESSAGES.TOOLTIP_SERVER_VERSION_SUPPORT);
    const progress = this.renderUpdateProgress(containerEl);
    let releases = [];
    let selectedTag = installed;
    let newerDevTag = null;
    let dropdown;
    let actionBtn;
    const refresh = () => {
      const tags = releases.map((r) => r.tag);
      const action = versionActionFor(tags, installed, selectedTag);
      let desc = versionDescription(action, installed, selectedTag, tags[0] === installed);
      const installedBuild = this.plugin.getSharedLilbeeVariant();
      if (installed && installedBuild) {
        desc += MESSAGES.DESC_SERVER_BUILD(MESSAGES.LABEL_SERVER_BUILD(installedBuild));
      }
      if (newerDevTag) desc += ` ${MESSAGES.DESC_DEV_BUILD_AVAILABLE(newerDevTag)}`;
      setting.setDesc(desc);
      actionBtn.setButtonText(versionButtonLabel(action, selectedTag));
      actionBtn.buttonEl.toggleClass("mod-cta", action === VERSION_ACTION.UPDATE);
      actionBtn.buttonEl.toggleClass("mod-warning", action === VERSION_ACTION.DOWNGRADE);
    };
    setting.addDropdown((dd) => {
      dropdown = dd;
      dd.setDisabled(true);
      dd.onChange((value) => {
        selectedTag = value;
        refresh();
      });
    });
    setting.addButton((btn) => {
      actionBtn = btn;
      btn.setDisabled(true);
      btn.setButtonText(MESSAGES.BUTTON_REINSTALL).onClick(async () => {
        const release = releases.find((r) => r.tag === selectedTag);
        if (!release) return;
        const label = versionButtonLabel(
          versionActionFor(
            releases.map((r) => r.tag),
            installed,
            selectedTag
          ),
          selectedTag
        );
        const updated = await this.runServerUpdate(release, btn, progress, label);
        if (updated && selectedTag !== releases[0].tag) {
          this.plugin.setServerAutoUpdate(false);
          this.render();
        }
      });
    });
    void this.loadReleases().then((loaded) => {
      if (loaded.releases === null) {
        setting.setDesc(
          installed ? MESSAGES.DESC_SERVER_VERSION_OFFLINE(installed, loaded.error) : MESSAGES.DESC_SERVER_VERSION_UNKNOWN
        );
        setting.addButton((btn) => btn.setButtonText(MESSAGES.BUTTON_RETRY).onClick(() => this.render()));
        return;
      }
      const all = loaded.releases;
      const includeDev = this.plugin.settings.includeDevBuilds;
      const newest = all[0];
      newerDevTag = !includeDev && newest && isDevBuild(newest.tag) && newest.tag !== installed ? newest.tag : null;
      releases = includeDev ? all : all.filter((r) => !isDevBuild(r.tag));
      if (releases.length === 0) return;
      if (!releases.some((r) => r.tag === selectedTag)) selectedTag = releases[0].tag;
      for (const release of releases) dropdown.addOption(release.tag, release.tag);
      dropdown.setValue(selectedTag);
      dropdown.setDisabled(false);
      actionBtn.setDisabled(false);
      refresh();
    });
  }
  /** Recent installable releases, dev builds included, or why GitHub could not be read. */
  async loadReleases() {
    if (this.releasesCache && Date.now() - this.releasesCache.at < RELEASES_CACHE_TTL_MS) {
      return { releases: this.releasesCache.releases };
    }
    try {
      const releases = await listReleases(true);
      this.releasesCache = { at: Date.now(), releases };
      return { releases };
    } catch (err3) {
      return { releases: null, error: errorMessage(err3, String(err3)) };
    }
  }
  /** Opt in to in-development builds. */
  renderDevBuildsToggle(containerEl) {
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_INCLUDE_DEV_BUILDS).setDesc(MESSAGES.DESC_INCLUDE_DEV_BUILDS).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.includeDevBuilds).onChange(async (value) => {
        this.plugin.settings.includeDevBuilds = value;
        await this.plugin.saveSettings();
        this.render();
      })
    );
  }
  /** Where bug reports go. Rendered at the top of the settings view in both server modes. */
  renderBugFeedback(containerEl) {
    const feedback = containerEl.createDiv({ cls: "lilbee-bug-feedback" });
    feedback.createSpan({ text: MESSAGES.BUG_FEEDBACK_PREFIX });
    const gh = feedback.createEl("a", { text: MESSAGES.BUG_FEEDBACK_GITHUB });
    gh.setAttribute("href", `${LILBEE_GITHUB_REPO_URL}/issues`);
    gh.setAttribute("target", "_blank");
    feedback.createSpan({ text: " or " });
    const irc = feedback.createEl("a", { text: MESSAGES.BUG_FEEDBACK_IRC });
    irc.setAttribute("href", LIBERA_LILBEE_URL);
    irc.setAttribute("target", "_blank");
    feedback.createSpan({ text: MESSAGES.BUG_FEEDBACK_SUFFIX });
  }
  /**
   * Managed mode only: Obsidian never removes the server this plugin downloaded.
   * Sized from the storage report so the model cache is walked once per render;
   * the delete plan is built when the button is clicked.
   */
  renderUninstallSection(containerEl, totalBytes) {
    const heading = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_UNINSTALL).setHeading();
    heading.settingEl.addClass("lilbee-danger-heading");
    heading.settingEl.setAttribute("aria-label", MESSAGES.TOOLTIP_UNINSTALL_SECTION);
    const callout = containerEl.createDiv({ cls: "lilbee-uninstall-callout" });
    const mark = callout.createSpan({ cls: "lilbee-uninstall-callout-mark", text: "!" });
    mark.setAttribute("aria-hidden", "true");
    callout.createEl("p", { text: MESSAGES.CALLOUT_UNINSTALL_FIRST });
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_UNINSTALL_SERVER).setDesc(MESSAGES.DESC_UNINSTALL_SERVER(formatDiskSize(totalBytes))).addButton((btn) => {
      btn.setButtonText(MESSAGES.BUTTON_UNINSTALL_SERVER).onClick(() => void this.confirmUninstall());
      btn.buttonEl.addClass("mod-warning");
    });
  }
  async confirmUninstall() {
    const plan = this.plugin.planServerUninstall();
    if (!plan) return;
    const modal = new UninstallModal(this.app, plan);
    modal.open();
    if (!await modal.result) return;
    try {
      const freed = await this.plugin.uninstallServer(plan);
      new import_obsidian13.Notice(MESSAGES.NOTICE_UNINSTALLED(formatDiskSize(freed)));
    } catch (err3) {
      new import_obsidian13.Notice(errorMessage(err3, MESSAGES.ERROR_UNINSTALL_FAILED));
      console.error("[lilbee] uninstall failed:", err3);
    }
    this.render();
  }
  /** Recovery path after an uninstall: pick a release and pull the server back. */
  renderInstallServer(containerEl) {
    if (this.plugin.isDownloadingServer()) {
      new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SERVER_STATUS).setDesc(MESSAGES.DESC_SERVER_DOWNLOADING).addButton((btn) => {
        btn.setButtonText(MESSAGES.BUTTON_CANCEL_DOWNLOAD).onClick(() => {
          this.plugin.cancelServerDownload();
          this.render();
        });
        btn.buttonEl.addClass("mod-warning");
      });
      return;
    }
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SERVER_STATUS).setDesc(MESSAGES.DESC_SERVER_NOT_INSTALLED);
    const setting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_INSTALL_SERVER).setDesc(MESSAGES.DESC_SERVER_VERSION_LOADING);
    setting.settingEl.setAttribute("aria-label", MESSAGES.TOOLTIP_SERVER_VERSION_SUPPORT);
    const progress = this.renderUpdateProgress(containerEl);
    let releases = [];
    let selectedTag = "";
    let dropdown;
    let installBtn;
    const describe = () => {
      const release = releases.find((r) => r.tag === selectedTag);
      if (!release) return;
      setting.setDesc(MESSAGES.DESC_INSTALL_SERVER(formatDiskSize(release.sizeBytes)));
    };
    setting.addDropdown((dd) => {
      dropdown = dd;
      dd.setDisabled(true);
      dd.onChange((value) => {
        selectedTag = value;
        describe();
      });
    });
    setting.addButton((btn) => {
      installBtn = btn;
      btn.setDisabled(true);
      btn.buttonEl.addClass("mod-cta");
      btn.setButtonText(MESSAGES.BUTTON_INSTALL_SERVER).onClick(async () => {
        const release = releases.find((r) => r.tag === selectedTag);
        if (!release) return;
        await this.runServerInstall(release, btn, progress);
      });
    });
    void this.loadReleases().then((loaded) => {
      if (loaded.releases === null) {
        setting.setDesc(MESSAGES.ERROR_RELEASE_LIST(loaded.error));
        setting.addButton((btn) => btn.setButtonText(MESSAGES.BUTTON_RETRY).onClick(() => this.render()));
        return;
      }
      releases = loaded.releases;
      if (releases.length === 0) return;
      selectedTag = releases[0].tag;
      for (const release of releases) dropdown.addOption(release.tag, release.tag);
      dropdown.setValue(selectedTag);
      dropdown.setDisabled(false);
      installBtn.setDisabled(false);
      describe();
    });
  }
  async runServerInstall(release, btn, progress) {
    btn.setDisabled(true);
    btn.setButtonText(MESSAGES.BUTTON_DOWNLOADING);
    progress.panel.show();
    progress.size.setText(MESSAGES.STATUS_UPDATE_SIZE(release.tag, formatDiskSize(release.sizeBytes)));
    try {
      await this.plugin.installServer(release, (msg, percent) => showPhase(progress, msg, percent));
      new import_obsidian13.Notice(MESSAGES.NOTICE_INSTALLED(release.tag));
      this.render();
    } catch (err3) {
      if (err3 instanceof DownloadCanceledError) {
        new import_obsidian13.Notice(MESSAGES.NOTICE_DOWNLOAD_CANCELED);
      } else {
        new import_obsidian13.Notice(errorMessage(err3, MESSAGES.ERROR_INSTALL_FAILED));
        console.error("[lilbee] install failed:", err3);
      }
      progress.panel.hide();
      btn.setButtonText(MESSAGES.BUTTON_INSTALL_SERVER);
      btn.setDisabled(false);
    }
  }
  /** Indeterminate progress panel for the managed-server update; hidden until an update runs. */
  renderUpdateProgress(containerEl) {
    const panel = containerEl.createDiv({ cls: "lilbee-update-progress" });
    panel.hide();
    const bar = panel.createDiv({ cls: "lilbee-progress-bar-container" });
    const fill = bar.createDiv({
      cls: "lilbee-progress-bar lilbee-wizard-progress-fill lilbee-progress-indeterminate"
    });
    const phase = panel.createDiv({ cls: "lilbee-update-progress-phase" });
    const size = panel.createDiv({ cls: "lilbee-update-progress-size" });
    const cancel = panel.createEl("button", {
      cls: "lilbee-update-progress-cancel",
      text: MESSAGES.BUTTON_CANCEL_DOWNLOAD
    });
    cancel.addEventListener("click", () => this.plugin.cancelServerDownload());
    return { panel, phase, size, fill, cancel };
  }
  /** Download and install *release*, surfacing phase + total download size. Returns false on failure. */
  async runServerUpdate(release, actionBtn, progress, restoreLabel) {
    actionBtn.setDisabled(true);
    actionBtn.setButtonText(MESSAGES.BUTTON_DOWNLOADING);
    progress.panel.show();
    progress.size.setText(MESSAGES.STATUS_UPDATE_SIZE(release.tag, formatDiskSize(release.sizeBytes)));
    try {
      await this.plugin.updateServer(release, (msg, percent) => showPhase(progress, msg, percent));
      new import_obsidian13.Notice(MESSAGES.NOTICE_UPDATED_TO(release.tag));
      this.render();
      return true;
    } catch (err3) {
      if (err3 instanceof DownloadCanceledError) {
        new import_obsidian13.Notice(MESSAGES.NOTICE_DOWNLOAD_CANCELED);
      } else {
        new import_obsidian13.Notice(errorMessage(err3, MESSAGES.ERROR_FAILED_UPDATE));
        console.error("[lilbee] update failed:", err3);
      }
      progress.panel.hide();
      actionBtn.setButtonText(restoreLabel);
      actionBtn.setDisabled(false);
      return false;
    }
  }
  renderSharedRootSetting(containerEl) {
    const resolved = this.plugin.vaultRegistry?.sharedRoot ?? "";
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SHARED_ROOT).setDesc(MESSAGES.DESC_SHARED_ROOT(resolved)).addText(
      (text) => text.setPlaceholder(resolved).setValue(this.plugin.settings.sharedRoot).onChange(async (value) => {
        this.plugin.settings.sharedRoot = value.trim();
        await this.plugin.saveSettings();
      })
    );
  }
  renderAdoptDataDir(containerEl) {
    const registry = this.plugin.vaultRegistry;
    if (!registry) return;
    let staged = "";
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_ADOPT_DATA_DIR).setDesc(MESSAGES.DESC_ADOPT_DATA_DIR).addText(
      (text) => text.setPlaceholder(MESSAGES.PLACEHOLDER_ADOPT_DATA_DIR).onChange((value) => {
        staged = value.trim();
      })
    ).addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_ADOPT_DATA_DIR).onClick(async () => {
        if (!staged) {
          new import_obsidian13.Notice(MESSAGES.NOTICE_ADOPT_DATA_DIR_BLANK);
          return;
        }
        await this.plugin.adoptDataDir(staged);
        new import_obsidian13.Notice(MESSAGES.NOTICE_ADOPT_DATA_DIR_DONE(staged));
        this.render();
      })
    );
  }
  /** Walks the shared install; the total is reused by the uninstall section. */
  renderStorageReport(containerEl) {
    const registry = this.plugin.vaultRegistry;
    if (!registry) return;
    const report = reportForVault(registry.sharedRoot, registry.resolveDataDir(this.plugin.vaultId));
    this.storageTotalBytes = report.totalBytes;
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_STORAGE_REPORT).setDesc(MESSAGES.DESC_STORAGE_REPORT);
    const list = containerEl.createDiv({ cls: "lilbee-storage-report" });
    appendStorageRow(list, MESSAGES.LABEL_STORAGE_BIN, report.binBytes);
    appendStorageRow(list, MESSAGES.LABEL_STORAGE_MODELS, report.modelsBytes);
    appendStorageRow(list, MESSAGES.LABEL_STORAGE_VAULT, report.vaultBytes, report.vaultDataDir);
    appendStorageRow(list, MESSAGES.LABEL_STORAGE_TOTAL, report.totalBytes);
  }
  renderDiagnostics(containerEl) {
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_EXPORT_DIAGNOSTICS).setDesc(MESSAGES.DESC_EXPORT_DIAGNOSTICS).addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_EXPORT_DIAGNOSTICS).onClick(() => {
        void exportDiagnostics(this.plugin.diagnosticsContext());
      })
    );
  }
  renderExternalSettings(containerEl) {
    const serverSetting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SERVER_URL).setDesc(MESSAGES.DESC_SERVER_URL_HELP).addText(
      (text) => text.setPlaceholder(MESSAGES.PLACEHOLDER_HTTP_LOCALHOST).setValue(this.plugin.settings.serverUrl).onChange(async (value) => {
        this.plugin.settings.serverUrl = value;
        await this.plugin.saveSettings();
      })
    );
    const serverStatusEl = serverSetting.settingEl.createSpan({ cls: "lilbee-health-status" });
    serverSetting.addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_TEST).onClick(async () => {
        await this.checkEndpoint(`${this.plugin.settings.serverUrl}/api/health`, serverStatusEl);
      })
    );
    this.appendLocalResetAffordance(serverSetting, "serverUrl", MESSAGES.LABEL_SERVER_URL);
    void this.checkEndpoint(`${this.plugin.settings.serverUrl}/api/health`, serverStatusEl);
    const manualTokenSetting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_MANUAL_TOKEN).setDesc(MESSAGES.DESC_MANUAL_TOKEN).addText((text) => {
      text.setPlaceholder("").setValue(this.plugin.settings.manualToken).onChange(async (value) => {
        this.plugin.settings.manualToken = value.trim();
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "password";
    });
    this.appendLocalResetAffordance(manualTokenSetting, "manualToken", MESSAGES.LABEL_MANUAL_TOKEN);
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SWITCH_MANAGED).setDesc(MESSAGES.DESC_SWITCH_MANAGED).addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_RESET_MANAGED).onClick(async () => {
        this.plugin.settings.serverMode = SERVER_MODE.MANAGED;
        this.plugin.settings.serverUrl = DEFAULT_SETTINGS.serverUrl;
        await this.plugin.saveSettings();
        this.render();
      })
    );
  }
  renderModelsSection(containerEl) {
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_MODELS).setHeading();
    containerEl.createEl("p", {
      text: MESSAGES.DESC_MODELS_HELP,
      cls: "setting-item-description"
    });
    const modelsContainer = containerEl.createDiv(CLS_MODELS_CONTAINER);
    const modelSettings = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_REFRESH_MODELS).setDesc(MESSAGES.DESC_REFRESH_MODELS).addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_REFRESH).onClick(async () => {
        await this.loadModels(modelsContainer);
      })
    );
    modelSettings.addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_BROWSE_CATALOG).onClick(() => {
        new CatalogModal(this.app, this.plugin).open();
      })
    );
    void this.loadModels(modelsContainer);
  }
  renderChatSettings(containerEl) {
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_CHAT_SECTION).setHeading();
    const showReasoningSetting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SHOW_REASONING).setDesc(MESSAGES.DESC_SHOW_REASONING).addToggle((toggle) => {
      toggle.onChange(async (value) => {
        if (this.suppressToggleChanges) return;
        try {
          await this.plugin.api.updateConfig({ [CONFIG_KEY.SHOW_REASONING]: value });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_SHOW_REASONING));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_SHOW_REASONING));
        }
      });
      this.serverConfigToggles.set(CONFIG_KEY.SHOW_REASONING, toggle);
    });
    showReasoningSetting.settingEl.hide();
    this.serverConfigHideableEls.set(CONFIG_KEY.SHOW_REASONING, showReasoningSetting.settingEl);
    const compactionSetting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_CHAT_COMPACTION).setDesc(MESSAGES.DESC_CHAT_COMPACTION).addToggle((toggle) => {
      toggle.onChange(async (value) => {
        if (this.suppressToggleChanges) return;
        try {
          await this.plugin.api.updateConfig({ [CONFIG_KEY.CHAT_COMPACTION]: value });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_CHAT_COMPACTION));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_CHAT_COMPACTION));
        }
      });
      this.serverConfigToggles.set(CONFIG_KEY.CHAT_COMPACTION, toggle);
    });
    compactionSetting.settingEl.hide();
    this.serverConfigHideableEls.set(CONFIG_KEY.CHAT_COMPACTION, compactionSetting.settingEl);
  }
  renderSearchRetrievalSettings(containerEl) {
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_SEARCH_RETRIEVAL).setHeading();
    const topKSetting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_RESULTS_COUNT).setDesc(MESSAGES.DESC_RESULTS_COUNT).addSlider(
      (slider) => slider.setLimits(1, 20, 1).setValue(this.plugin.settings.topK).onChange(async (value) => {
        this.plugin.settings.topK = value;
        await this.plugin.saveSettings();
      })
    );
    this.appendLocalResetAffordance(topKSetting, "topK", MESSAGES.LABEL_RESULTS_COUNT);
    const maxDistanceSetting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_MAX_DISTANCE).setDesc(MESSAGES.DESC_MAX_DISTANCE).addSlider(
      (slider) => slider.setLimits(0.1, 1, 0.1).setValue(this.plugin.settings.maxDistance ?? 0.9).onChange(async (value) => {
        this.plugin.settings.maxDistance = value;
        await this.plugin.saveSettings();
      })
    );
    this.appendLocalResetAffordance(maxDistanceSetting, "maxDistance", MESSAGES.LABEL_MAX_DISTANCE);
    const adaptiveSetting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_ADAPTIVE_THRESHOLD).setDesc(MESSAGES.DESC_ADAPTIVE_THRESHOLD).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.adaptiveThreshold ?? false).onChange(async (value) => {
        this.plugin.settings.adaptiveThreshold = value;
        await this.plugin.saveSettings();
      })
    );
    this.appendLocalResetAffordance(adaptiveSetting, "adaptiveThreshold", MESSAGES.LABEL_ADAPTIVE_THRESHOLD);
  }
  loadServerDefaults() {
    this.plugin.api.config().then((cfg) => {
      for (const [key, inputEl] of this.serverConfigInputs) {
        const v = cfg[key];
        if (v === void 0) continue;
        const formatted = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
        inputEl.value = formatted;
        if (formatted !== "") {
          inputEl.placeholder = formatted;
        }
      }
      for (const [key, toggle] of this.serverConfigToggles) {
        const v = cfg[key];
        if (typeof v === "boolean") {
          this.suppressToggleChanges = true;
          try {
            toggle.setValue(v);
          } finally {
            this.suppressToggleChanges = false;
          }
        }
      }
      for (const [key, textArea] of this.serverConfigTextAreas) {
        const v = cfg[key];
        if (Array.isArray(v)) {
          textArea.value = v.join("\n");
        }
      }
      for (const [key, dropdown] of this.serverConfigDropdowns) {
        const v = cfg[key];
        if (typeof v === "string") {
          dropdown.setValue(v);
        }
      }
      if (typeof cfg.rag_system_prompt === "string") {
        const ragInput = this.serverConfigInputs.get("rag_system_prompt");
        if (ragInput) {
          ragInput.placeholder = cfg.rag_system_prompt;
        }
      }
      if (typeof cfg.general_system_prompt === "string") {
        const generalInput = this.serverConfigInputs.get("general_system_prompt");
        if (generalInput) {
          generalInput.placeholder = cfg.general_system_prompt;
        }
      }
      this.applyChatModeFromConfig(cfg);
      this.applyHideableConfigFields(cfg);
    }).catch(() => {
    });
  }
  applyHideableConfigFields(cfg) {
    for (const [key, settingEl] of this.serverConfigHideableEls) {
      if (cfg[key] !== void 0) {
        settingEl.show();
      }
    }
  }
  applyChatModeFromConfig(cfg) {
    if (!this.chatModeSettingEl) return;
    if (cfg.chat_mode === void 0) {
      this.chatModeSettingEl.hide();
      return;
    }
    this.chatModeSettingEl.show();
    if (this.chatModeDropdown) {
      this.chatModeDropdown.setValue(cfg.chat_mode);
    }
    if (this.chatModeSelectEl) {
      const noEmbedding = !cfg.embedding_model || cfg.embedding_model === "";
      this.chatModeSelectEl.disabled = noEmbedding;
      this.chatModeSelectEl.title = noEmbedding ? MESSAGES.TOOLTIP_CHAT_MODE_NEEDS_EMBEDDING : "";
    }
  }
  loadConfigDefaults() {
    this.plugin.api.configDefaults().then((defaults) => {
      this.configDefaults = defaults;
    }).catch(() => {
      this.configDefaults = {};
    });
  }
  appendResetAffordance(setting, key, label) {
    return setting.addExtraButton(
      (btn) => btn.setIcon(ICON_RESET).setTooltip(MESSAGES.LABEL_RESET_TO_DEFAULT).onClick(async () => {
        if (!(key in this.configDefaults)) return;
        const def = this.configDefaults[key];
        try {
          await this.plugin.api.updateConfig({ [key]: def });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_RESET(label));
          this.render();
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_RESET(label));
        }
      })
    );
  }
  appendLocalResetAffordance(setting, key, label) {
    return setting.addExtraButton(
      (btn) => btn.setIcon(ICON_RESET).setTooltip(MESSAGES.LABEL_RESET_TO_DEFAULT).onClick(async () => {
        this.plugin.settings[key] = DEFAULT_SETTINGS[key];
        await this.plugin.saveSettings();
        new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_RESET(label));
        this.render();
      })
    );
  }
  /**
   * Reset affordance for fields that dual-write: PATCH the server default AND mirror it back
   * into `plugin.settings[localKey]`. Prevents the re-render from picking up a stale local value
   * via `toggle.setValue(this.plugin.settings[localKey])`.
   */
  appendDualResetAffordance(setting, serverKey, localKey, label) {
    return setting.addExtraButton(
      (btn) => btn.setIcon(ICON_RESET).setTooltip(MESSAGES.LABEL_RESET_TO_DEFAULT).onClick(async () => {
        if (!(serverKey in this.configDefaults)) return;
        const def = this.configDefaults[serverKey];
        try {
          await this.plugin.api.updateConfig({ [serverKey]: def });
          this.plugin.settings[localKey] = def;
          await this.plugin.saveSettings();
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_RESET(label));
          this.render();
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_RESET(label));
        }
      })
    );
  }
  renderGenerationSettings(containerEl) {
    const details = containerEl.createEl("details", { cls: "lilbee-generation-details lilbee-settings-section" });
    const modelLabel = displayLabelForRef(this.plugin.activeModel) || MESSAGES.LABEL_NO_MODEL_SELECTED;
    details.createEl("summary", { text: `${MESSAGES.LABEL_GENERATION} (${modelLabel})` });
    details.createEl("p", {
      text: MESSAGES.LABEL_GENERATION_HELP,
      cls: "setting-item-description"
    });
    const ragPromptSetting = new import_obsidian13.Setting(details).setName(MESSAGES.LABEL_RAG_SYSTEM_PROMPT).setDesc(MESSAGES.DESC_RAG_SYSTEM_PROMPT).addTextArea((text) => {
      text.setPlaceholder(MESSAGES.PLACEHOLDER_DEFAULT).setValue(this.plugin.settings.ragSystemPrompt).onChange(async (value) => {
        this.plugin.settings.ragSystemPrompt = value;
        await this.plugin.saveSettings();
      });
      this.serverConfigInputs.set("rag_system_prompt", text.inputEl);
    });
    this.appendLocalResetAffordance(ragPromptSetting, "ragSystemPrompt", MESSAGES.LABEL_RAG_SYSTEM_PROMPT);
    const generalPromptSetting = new import_obsidian13.Setting(details).setName(MESSAGES.LABEL_GENERAL_SYSTEM_PROMPT).setDesc(MESSAGES.DESC_GENERAL_SYSTEM_PROMPT).addTextArea((text) => {
      text.setPlaceholder(MESSAGES.PLACEHOLDER_DEFAULT).setValue(this.plugin.settings.generalSystemPrompt).onChange(async (value) => {
        this.plugin.settings.generalSystemPrompt = value;
        await this.plugin.saveSettings();
      });
      this.serverConfigInputs.set("general_system_prompt", text.inputEl);
    });
    this.appendLocalResetAffordance(
      generalPromptSetting,
      "generalSystemPrompt",
      MESSAGES.LABEL_GENERAL_SYSTEM_PROMPT
    );
    const chatModeSetting = new import_obsidian13.Setting(details).setName(MESSAGES.LABEL_CHAT_MODE).setDesc(MESSAGES.DESC_CHAT_MODE).addDropdown((dd) => {
      dd.addOption(CHAT_MODE.SEARCH, MESSAGES.LABEL_CHAT_MODE_SEARCH);
      dd.addOption(CHAT_MODE.CHAT, MESSAGES.LABEL_CHAT_MODE_CHAT);
      dd.setValue(CHAT_MODE.SEARCH);
      dd.onChange(async (value) => {
        try {
          await this.plugin.api.updateConfig({ [CONFIG_KEY.CHAT_MODE]: value });
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_CHAT_MODE));
        }
      });
      this.chatModeDropdown = dd;
      this.chatModeSelectEl = dd.selectEl;
    });
    this.chatModeSettingEl = chatModeSetting.settingEl;
    this.chatModeSettingEl.hide();
    const fields = [
      {
        key: "temperature",
        name: MESSAGES.LABEL_GEN_TEMPERATURE,
        desc: MESSAGES.DESC_GEN_TEMPERATURE,
        integer: false
      },
      {
        key: "top_p",
        name: MESSAGES.LABEL_GEN_TOP_P,
        desc: MESSAGES.DESC_GEN_TOP_P,
        integer: false
      },
      {
        key: "top_k_sampling",
        name: MESSAGES.LABEL_GEN_TOP_K,
        desc: MESSAGES.DESC_GEN_TOP_K,
        integer: true
      },
      {
        key: "repeat_penalty",
        name: MESSAGES.LABEL_GEN_REPEAT_PENALTY,
        desc: MESSAGES.DESC_GEN_REPEAT_PENALTY,
        integer: false
      },
      // num_ctx is intentionally not surfaced — it's a model-side
      // property. The server picks a context window appropriate to the
      // active model; exposing it as a user knob invites mismatches
      // (asking for more than the model supports, or over-allocating
      // RAM for no benefit).
      {
        key: "seed",
        name: MESSAGES.LABEL_GEN_SEED,
        desc: MESSAGES.DESC_GEN_SEED,
        integer: true
      },
      {
        key: "max_tokens",
        name: MESSAGES.LABEL_GEN_MAX_TOKENS,
        desc: MESSAGES.DESC_GEN_MAX_TOKENS,
        integer: true,
        hideable: true
      },
      {
        key: "max_reasoning_chars",
        name: MESSAGES.LABEL_GEN_MAX_REASONING_CHARS,
        desc: MESSAGES.DESC_GEN_MAX_REASONING_CHARS,
        integer: true,
        hideable: true
      },
      {
        key: "model_keep_alive",
        name: MESSAGES.LABEL_GEN_MODEL_KEEP_ALIVE,
        desc: MESSAGES.DESC_GEN_MODEL_KEEP_ALIVE,
        integer: true,
        hideable: true
      },
      {
        key: "gpu_memory_fraction",
        name: MESSAGES.LABEL_GEN_GPU_MEMORY_FRACTION,
        desc: MESSAGES.DESC_GEN_GPU_MEMORY_FRACTION,
        integer: false,
        hideable: true
      }
    ];
    for (const field of fields) {
      const genSetting = new import_obsidian13.Setting(details).setName(field.name).setDesc(field.desc).addText((text) => {
        text.setPlaceholder(MESSAGES.PLACEHOLDER_NOT_SET).setValue("").onChange(async (value) => {
          const trimmed = value.trim();
          if (trimmed === "") {
            try {
              await this.plugin.api.updateConfig({ [field.key]: null });
              new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(field.name));
            } catch {
              new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(field.name));
            }
            return;
          }
          const num = field.integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
          if (isNaN(num)) return;
          try {
            await this.plugin.api.updateConfig({ [field.key]: num });
            new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(field.name));
          } catch {
            new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(field.name));
          }
        });
        this.serverConfigInputs.set(field.key, text.inputEl);
      });
      this.appendResetAffordance(genSetting, field.key, field.name);
      if (field.hideable) {
        genSetting.settingEl.hide();
        this.serverConfigHideableEls.set(field.key, genSetting.settingEl);
      }
    }
  }
  renderWorkerPoolSettings(containerEl) {
    const details = containerEl.createEl("details", {
      cls: "lilbee-worker-pool-details lilbee-settings-section"
    });
    details.createEl("summary", { text: MESSAGES.LABEL_WORKER_POOL });
    details.createEl("p", {
      text: MESSAGES.LABEL_WORKER_POOL_HELP,
      cls: "setting-item-description"
    });
    const callTimeoutSetting = this.renderHideableNumberField(
      details,
      "worker_pool_call_timeout_s",
      MESSAGES.LABEL_WORKER_POOL_CALL_TIMEOUT,
      MESSAGES.DESC_WORKER_POOL_CALL_TIMEOUT,
      { integer: false, min: 0 }
    );
    this.appendResetAffordance(
      callTimeoutSetting,
      "worker_pool_call_timeout_s",
      MESSAGES.LABEL_WORKER_POOL_CALL_TIMEOUT
    );
    const eagerStartSetting = new import_obsidian13.Setting(details).setName(MESSAGES.LABEL_WORKER_POOL_EAGER_START).setDesc(MESSAGES.DESC_WORKER_POOL_EAGER_START).addToggle((toggle) => {
      toggle.onChange(async (value) => {
        if (this.suppressToggleChanges) return;
        try {
          await this.plugin.api.updateConfig({ worker_pool_eager_start: value });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_WORKER_POOL_EAGER_START));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_WORKER_POOL_EAGER_START));
        }
      });
      this.serverConfigToggles.set("worker_pool_eager_start", toggle);
    });
    this.appendResetAffordance(
      eagerStartSetting,
      "worker_pool_eager_start",
      MESSAGES.LABEL_WORKER_POOL_EAGER_START
    );
    eagerStartSetting.settingEl.hide();
    this.serverConfigHideableEls.set("worker_pool_eager_start", eagerStartSetting.settingEl);
    const maxIdleSetting = this.renderHideableNumberField(
      details,
      "worker_pool_max_idle_s",
      MESSAGES.LABEL_WORKER_POOL_MAX_IDLE,
      MESSAGES.DESC_WORKER_POOL_MAX_IDLE,
      { integer: false, min: 0 }
    );
    this.appendResetAffordance(maxIdleSetting, "worker_pool_max_idle_s", MESSAGES.LABEL_WORKER_POOL_MAX_IDLE);
  }
  /** GPU / fleet tuning knobs not surfaced in the placement view. Each row stays
   * hidden until the connected server reports the key, so older servers show none. */
  renderFleetSettings(containerEl) {
    const details = containerEl.createEl("details", { cls: "lilbee-fleet-details lilbee-settings-section" });
    details.createEl("summary", { text: MESSAGES.LABEL_FLEET });
    details.createEl("p", { text: MESSAGES.LABEL_FLEET_HELP, cls: "setting-item-description" });
    const kvContainer = details.createDiv();
    const kvSetting = new import_obsidian13.Setting(kvContainer).setName(MESSAGES.LABEL_KV_CACHE_TYPE).setDesc(MESSAGES.DESC_KV_CACHE_TYPE).addDropdown((dropdown) => {
      dropdown.addOption(KV_CACHE_TYPE.F16, KV_CACHE_TYPE.F16);
      dropdown.addOption(KV_CACHE_TYPE.Q8_0, KV_CACHE_TYPE.Q8_0);
      dropdown.addOption(KV_CACHE_TYPE.Q4_0, KV_CACHE_TYPE.Q4_0);
      dropdown.addOption(KV_CACHE_TYPE.F32, KV_CACHE_TYPE.F32);
      dropdown.setValue(KV_CACHE_TYPE.Q8_0);
      dropdown.onChange(async (value) => {
        try {
          await this.plugin.api.updateConfig({ kv_cache_type: value });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_KV_CACHE_TYPE));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_KV_CACHE_TYPE));
        }
      });
      this.serverConfigDropdowns.set("kv_cache_type", dropdown);
    });
    this.appendResetAffordance(kvSetting, "kv_cache_type", MESSAGES.LABEL_KV_CACHE_TYPE);
    kvContainer.hide();
    this.serverConfigHideableEls.set("kv_cache_type", kvContainer);
    const flashContainer = details.createDiv();
    const flashSetting = new import_obsidian13.Setting(flashContainer).setName(MESSAGES.LABEL_FLASH_ATTENTION).setDesc(MESSAGES.DESC_FLASH_ATTENTION).addToggle((toggle) => {
      toggle.onChange(async (value) => {
        if (this.suppressToggleChanges) return;
        try {
          await this.plugin.api.updateConfig({ flash_attention: value });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_FLASH_ATTENTION));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_FLASH_ATTENTION));
        }
      });
      this.serverConfigToggles.set("flash_attention", toggle);
    });
    this.appendResetAffordance(flashSetting, "flash_attention", MESSAGES.LABEL_FLASH_ATTENTION);
    flashContainer.hide();
    this.serverConfigHideableEls.set("flash_attention", flashContainer);
    const layers = this.renderHideableNumberField(
      details,
      "n_gpu_layers",
      MESSAGES.LABEL_N_GPU_LAYERS,
      MESSAGES.DESC_N_GPU_LAYERS,
      { integer: true, min: 0 }
    );
    this.appendResetAffordance(layers, "n_gpu_layers", MESSAGES.LABEL_N_GPU_LAYERS);
    const embedReplicas = this.renderHideableNumberField(
      details,
      "embed_replicas",
      MESSAGES.LABEL_EMBED_REPLICAS,
      MESSAGES.DESC_EMBED_REPLICAS,
      { integer: true, min: 0 }
    );
    this.appendResetAffordance(embedReplicas, "embed_replicas", MESSAGES.LABEL_EMBED_REPLICAS);
    const visionReplicas = this.renderHideableNumberField(
      details,
      "vision_replicas",
      MESSAGES.LABEL_VISION_REPLICAS,
      MESSAGES.DESC_VISION_REPLICAS,
      { integer: true, min: 0 }
    );
    this.appendResetAffordance(visionReplicas, "vision_replicas", MESSAGES.LABEL_VISION_REPLICAS);
    const devContainer = details.createDiv();
    const devSetting = new import_obsidian13.Setting(devContainer).setName(MESSAGES.LABEL_GPU_DEVICES).setDesc(MESSAGES.DESC_GPU_DEVICES).addText((text) => {
      text.setPlaceholder(MESSAGES.PLACEHOLDER_GPU_DEVICES).setValue("").onChange(async (value) => {
        const trimmed = value.trim();
        try {
          await this.plugin.api.updateConfig({ gpu_devices: trimmed === "" ? null : trimmed });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_GPU_DEVICES));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_GPU_DEVICES));
        }
      });
      this.serverConfigInputs.set("gpu_devices", text.inputEl);
    });
    this.appendResetAffordance(devSetting, "gpu_devices", MESSAGES.LABEL_GPU_DEVICES);
    devContainer.hide();
    this.serverConfigHideableEls.set("gpu_devices", devContainer);
  }
  renderIngestSettings(containerEl) {
    const details = containerEl.createEl("details", {
      cls: "lilbee-ingest-details lilbee-settings-section"
    });
    details.createEl("summary", { text: MESSAGES.LABEL_INGEST });
    details.createEl("p", {
      text: MESSAGES.LABEL_INGEST_HELP,
      cls: "setting-item-description"
    });
    this.renderConfigToggle(
      details,
      "layout_detection",
      MESSAGES.LABEL_LAYOUT_DETECTION,
      MESSAGES.DESC_LAYOUT_DETECTION
    );
    this.renderConfigToggle(
      details,
      "table_extraction",
      MESSAGES.LABEL_TABLE_EXTRACTION,
      MESSAGES.DESC_TABLE_EXTRACTION
    );
    const tableModelSetting = new import_obsidian13.Setting(details).setName(MESSAGES.LABEL_TABLE_MODEL).setDesc(MESSAGES.DESC_TABLE_MODEL).addDropdown((dropdown) => {
      for (const model of Object.values(TABLE_MODEL)) dropdown.addOption(model, model);
      dropdown.setValue(TABLE_MODEL.SLANET_AUTO);
      dropdown.onChange(async (value) => {
        try {
          await this.plugin.api.updateConfig({ table_model: value });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_TABLE_MODEL));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_TABLE_MODEL));
        }
      });
      this.serverConfigDropdowns.set("table_model", dropdown);
    });
    this.appendResetAffordance(tableModelSetting, "table_model", MESSAGES.LABEL_TABLE_MODEL);
    this.renderConfigList(details, "ocr_language", MESSAGES.LABEL_OCR_LANGUAGE, MESSAGES.DESC_OCR_LANGUAGE);
    const ingestProcesses = this.renderHideableNumberField(
      details,
      "ingest_processes",
      MESSAGES.LABEL_INGEST_PROCESSES,
      MESSAGES.DESC_INGEST_PROCESSES,
      { integer: true, min: 0 }
    );
    this.appendResetAffordance(ingestProcesses, "ingest_processes", MESSAGES.LABEL_INGEST_PROCESSES);
    const memReserve = this.renderHideableNumberField(
      details,
      "system_memory_reserve_gb",
      MESSAGES.LABEL_SYSTEM_MEMORY_RESERVE_GB,
      MESSAGES.DESC_SYSTEM_MEMORY_RESERVE_GB,
      { integer: false, min: 0 }
    );
    this.appendResetAffordance(memReserve, "system_memory_reserve_gb", MESSAGES.LABEL_SYSTEM_MEMORY_RESERVE_GB);
    const vramFraction = this.renderHideableNumberField(
      details,
      "usable_vram_fraction",
      MESSAGES.LABEL_USABLE_VRAM_FRACTION,
      MESSAGES.DESC_USABLE_VRAM_FRACTION,
      { integer: false, min: 0 }
    );
    this.appendResetAffordance(vramFraction, "usable_vram_fraction", MESSAGES.LABEL_USABLE_VRAM_FRACTION);
    this.renderConfigToggle(
      details,
      "fast_model_downloads",
      MESSAGES.LABEL_FAST_MODEL_DOWNLOADS,
      MESSAGES.DESC_FAST_MODEL_DOWNLOADS
    );
    const chunkSizeSetting = this.renderHideableNumberField(
      details,
      "chunk_size",
      MESSAGES.LABEL_CHUNK_SIZE,
      MESSAGES.DESC_CHUNK_SIZE,
      { integer: true, min: 1, reindex: true }
    );
    this.appendResetAffordance(chunkSizeSetting, "chunk_size", MESSAGES.LABEL_CHUNK_SIZE);
    const chunkOverlapSetting = this.renderHideableNumberField(
      details,
      "chunk_overlap",
      MESSAGES.LABEL_CHUNK_OVERLAP,
      MESSAGES.DESC_CHUNK_OVERLAP,
      { integer: true, min: 0, reindex: true }
    );
    this.appendResetAffordance(chunkOverlapSetting, "chunk_overlap", MESSAGES.LABEL_CHUNK_OVERLAP);
    const tesseractSetting = this.renderHideableNumberField(
      details,
      "tesseract_timeout",
      MESSAGES.LABEL_TESSERACT_TIMEOUT,
      MESSAGES.DESC_TESSERACT_TIMEOUT,
      { integer: false, min: 0 }
    );
    this.appendResetAffordance(tesseractSetting, "tesseract_timeout", MESSAGES.LABEL_TESSERACT_TIMEOUT);
    const visionBudgetSetting = this.renderHideableNumberField(
      details,
      "vision_load_budget_s",
      MESSAGES.LABEL_VISION_LOAD_BUDGET,
      MESSAGES.DESC_VISION_LOAD_BUDGET,
      { integer: false, min: 0 }
    );
    this.appendResetAffordance(visionBudgetSetting, "vision_load_budget_s", MESSAGES.LABEL_VISION_LOAD_BUDGET);
  }
  renderMemorySection(containerEl) {
    const section = containerEl.createDiv({ cls: "lilbee-settings-section" });
    new import_obsidian13.Setting(section).setName(MESSAGES.LABEL_MEMORY_SECTION).setHeading();
    this.plugin.api.config().then((cfg) => {
      this.renderMemoryToggle(
        section,
        MEMORY_CONFIG_KEY.ENABLED,
        cfg[MEMORY_CONFIG_KEY.ENABLED] === true,
        MESSAGES.LABEL_MEMORY_ENABLED,
        MESSAGES.DESC_MEMORY_ENABLED
      );
      this.renderMemoryToggle(
        section,
        MEMORY_CONFIG_KEY.AUTO_EXTRACT,
        cfg[MEMORY_CONFIG_KEY.AUTO_EXTRACT] === true,
        MESSAGES.LABEL_MEMORY_AUTO_EXTRACT,
        MESSAGES.DESC_MEMORY_AUTO_EXTRACT
      );
    }).catch((err3) => {
      if (noticeServerUnreachableIfApplicable(err3)) return;
      this.plugin.journal.record(MESSAGES.NOTICE_MEMORY_CONFIG_FAILED, errorMessage(err3, ""));
    });
  }
  renderMemoryToggle(section, key, initial, name, desc) {
    new import_obsidian13.Setting(section).setName(name).setDesc(desc).addToggle((toggle) => {
      toggle.setValue(initial);
      toggle.onChange(async (value) => {
        try {
          await this.plugin.api.updateConfig({ [key]: value });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(name));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(name));
        }
      });
      this.memoryToggles.set(key, toggle);
    });
  }
  renderRetrievalAdvanced(containerEl) {
    const details = containerEl.createEl("details", {
      cls: "lilbee-retrieval-advanced-details lilbee-settings-section"
    });
    details.createEl("summary", { text: MESSAGES.LABEL_RETRIEVAL_ADVANCED });
    details.createEl("p", {
      text: MESSAGES.LABEL_RETRIEVAL_ADVANCED_HELP,
      cls: "setting-item-description"
    });
    const candidateSetting = this.renderHideableNumberField(
      details,
      "candidate_multiplier",
      MESSAGES.LABEL_CANDIDATE_MULTIPLIER,
      MESSAGES.DESC_CANDIDATE_MULTIPLIER,
      { integer: true, min: 1 }
    );
    this.appendResetAffordance(candidateSetting, "candidate_multiplier", MESSAGES.LABEL_CANDIDATE_MULTIPLIER);
    const minRelevanceSetting = this.renderHideableNumberField(
      details,
      "min_relevance_score",
      MESSAGES.LABEL_MIN_RELEVANCE_SCORE,
      MESSAGES.DESC_MIN_RELEVANCE_SCORE,
      { integer: false, min: 0 }
    );
    this.appendResetAffordance(minRelevanceSetting, "min_relevance_score", MESSAGES.LABEL_MIN_RELEVANCE_SCORE);
    const maxSourcesSetting = this.renderHideableNumberField(
      details,
      "max_context_sources",
      MESSAGES.LABEL_MAX_CONTEXT_SOURCES,
      MESSAGES.DESC_MAX_CONTEXT_SOURCES,
      { integer: true, min: 1 }
    );
    this.appendResetAffordance(maxSourcesSetting, "max_context_sources", MESSAGES.LABEL_MAX_CONTEXT_SOURCES);
    const diversitySetting = this.renderHideableNumberField(
      details,
      "diversity_max_per_source",
      MESSAGES.LABEL_DIVERSITY_MAX_PER_SOURCE,
      MESSAGES.DESC_DIVERSITY_MAX_PER_SOURCE,
      { integer: true, min: 1 }
    );
    this.appendResetAffordance(
      diversitySetting,
      "diversity_max_per_source",
      MESSAGES.LABEL_DIVERSITY_MAX_PER_SOURCE
    );
    this.renderConfigToggle(details, "title_search", MESSAGES.LABEL_TITLE_SEARCH, MESSAGES.DESC_TITLE_SEARCH);
    const titleWeight = this.renderHideableNumberField(
      details,
      "title_search_weight",
      MESSAGES.LABEL_TITLE_SEARCH_WEIGHT,
      MESSAGES.DESC_TITLE_SEARCH_WEIGHT,
      { integer: false, min: 0 }
    );
    this.appendResetAffordance(titleWeight, "title_search_weight", MESSAGES.LABEL_TITLE_SEARCH_WEIGHT);
    this.renderConfigToggle(
      details,
      "adaptive_fusion",
      MESSAGES.LABEL_ADAPTIVE_FUSION,
      MESSAGES.DESC_ADAPTIVE_FUSION
    );
    const fusionMargin = this.renderHideableNumberField(
      details,
      "adaptive_fusion_margin",
      MESSAGES.LABEL_ADAPTIVE_FUSION_MARGIN,
      MESSAGES.DESC_ADAPTIVE_FUSION_MARGIN,
      { integer: false, min: 0 }
    );
    this.appendResetAffordance(fusionMargin, "adaptive_fusion_margin", MESSAGES.LABEL_ADAPTIVE_FUSION_MARGIN);
    const lexicalWeight = this.renderHideableNumberField(
      details,
      "lexical_fusion_weight",
      MESSAGES.LABEL_LEXICAL_FUSION_WEIGHT,
      MESSAGES.DESC_LEXICAL_FUSION_WEIGHT,
      { integer: false, min: 0 }
    );
    this.appendResetAffordance(lexicalWeight, "lexical_fusion_weight", MESSAGES.LABEL_LEXICAL_FUSION_WEIGHT);
    const neighbors = this.renderHideableNumberField(
      details,
      "neighbor_expansion",
      MESSAGES.LABEL_NEIGHBOR_EXPANSION,
      MESSAGES.DESC_NEIGHBOR_EXPANSION,
      { integer: true, min: 0 }
    );
    this.appendResetAffordance(neighbors, "neighbor_expansion", MESSAGES.LABEL_NEIGHBOR_EXPANSION);
    this.renderConfigToggle(
      details,
      "filter_structural_chunks",
      MESSAGES.LABEL_FILTER_STRUCTURAL_CHUNKS,
      MESSAGES.DESC_FILTER_STRUCTURAL_CHUNKS
    );
    const rerankMin = this.renderHideableNumberField(
      details,
      "rerank_min_score",
      MESSAGES.LABEL_RERANK_MIN_SCORE,
      MESSAGES.DESC_RERANK_MIN_SCORE,
      { integer: false, min: 0 }
    );
    this.appendResetAffordance(rerankMin, "rerank_min_score", MESSAGES.LABEL_RERANK_MIN_SCORE);
    const ftsLanguage = new import_obsidian13.Setting(details).setName(MESSAGES.LABEL_FTS_LANGUAGE).setDesc(MESSAGES.DESC_FTS_LANGUAGE).addText((text) => {
      text.onChange(async (value) => {
        const trimmed = value.trim();
        if (trimmed === "") return;
        try {
          await this.plugin.api.updateConfig({ fts_language: trimmed });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_FTS_LANGUAGE));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_FTS_LANGUAGE));
        }
      });
      this.serverConfigInputs.set("fts_language", text.inputEl);
    });
    this.appendResetAffordance(ftsLanguage, "fts_language", MESSAGES.LABEL_FTS_LANGUAGE);
    this.renderConfigToggle(
      details,
      "contextual_enrichment",
      MESSAGES.LABEL_CONTEXTUAL_ENRICHMENT,
      MESSAGES.DESC_CONTEXTUAL_ENRICHMENT
    );
    this.renderConfigToggle(details, "embed_titles", MESSAGES.LABEL_EMBED_TITLES, MESSAGES.DESC_EMBED_TITLES);
    this.renderConfigToggle(details, "token_sizing", MESSAGES.LABEL_TOKEN_SIZING, MESSAGES.DESC_TOKEN_SIZING);
    const mmrSetting = this.renderHideableNumberField(
      details,
      "mmr_lambda",
      MESSAGES.LABEL_MMR_LAMBDA,
      MESSAGES.DESC_MMR_LAMBDA,
      { integer: false, min: 0 }
    );
    this.appendResetAffordance(mmrSetting, "mmr_lambda", MESSAGES.LABEL_MMR_LAMBDA);
  }
  /** A server-config boolean, registered so loadServerDefaults can fill it. */
  renderConfigToggle(container, key, name, desc) {
    const setting = new import_obsidian13.Setting(container).setName(name).setDesc(desc).addToggle((toggle) => {
      toggle.onChange(async (value) => {
        if (this.suppressToggleChanges) return;
        try {
          await this.plugin.api.updateConfig({ [key]: value });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(name));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(name));
        }
      });
      this.serverConfigToggles.set(key, toggle);
    });
    this.appendResetAffordance(setting, key, name);
  }
  /** A server-config list of short strings, one per line (e.g. OCR languages). */
  renderConfigList(container, key, name, desc) {
    const setting = new import_obsidian13.Setting(container).setName(name).setDesc(desc).addTextArea((area) => {
      area.onChange(async (value) => {
        const items = value.split("\n").map((line) => line.trim()).filter((line) => line !== "");
        try {
          await this.plugin.api.updateConfig({ [key]: items.length > 0 ? items : null });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(name));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(name));
        }
      });
      this.serverConfigTextAreas.set(key, area.inputEl);
    });
    this.appendResetAffordance(setting, key, name);
  }
  renderHideableNumberField(container, key, name, desc, opts) {
    const setting = new import_obsidian13.Setting(container).setName(name).setDesc(desc).addText((text) => {
      text.setPlaceholder(MESSAGES.PLACEHOLDER_NOT_SET).setValue("").onChange(async (value) => {
        await this.handleHideableNumberChange(value, key, name, opts);
      });
      this.serverConfigInputs.set(key, text.inputEl);
    });
    setting.settingEl.hide();
    this.serverConfigHideableEls.set(key, setting.settingEl);
    return setting;
  }
  async handleHideableNumberChange(value, key, name, opts) {
    const trimmed = value.trim();
    if (trimmed === "") return;
    const num = opts.integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
    if (isNaN(num)) return;
    if (opts.min !== void 0 && num < opts.min) return;
    if (opts.reindex) {
      const confirmModal = new ConfirmModal(this.app, MESSAGES.DESC_REINDEX_WARNING.replace("{field}", name));
      confirmModal.open();
      const confirmed = await confirmModal.result;
      if (!confirmed) return;
    }
    try {
      const result = await this.plugin.api.updateConfig({ [key]: num });
      new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(name));
      if (opts.reindex && result.reindex_required) {
        new import_obsidian13.Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
        void this.plugin.triggerSync();
      }
    } catch {
      new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(name));
    }
  }
  loadEmbeddingDropdown(container) {
    this.plugin.api.catalog({ task: MODEL_TASK.EMBEDDING }).then((result) => {
      if (result.isErr()) {
        this.renderEmbeddingFallback(container);
        return;
      }
      const catalogEntries = result.value.models;
      const localInstalled = catalogEntries.filter(
        (m) => m.task === MODEL_TASK.EMBEDDING && m.installed && !HOSTED_SOURCES.has(m.source)
      );
      new import_obsidian13.Setting(container).setName(MESSAGES.LABEL_EMBEDDING_MODEL).setDesc(MESSAGES.DESC_EMBEDDING_MODEL).addDropdown((dropdown) => {
        for (const model of localInstalled) {
          dropdown.addOption(model.hf_repo, model.display_name);
        }
        for (const [ref, label] of hostedOptions(catalogEntries)) {
          dropdown.addOption(ref, label);
        }
        dropdown.onChange(async (value) => {
          if (!value) return;
          const confirmModal = new ConfirmModal(this.app, MESSAGES.DESC_EMBEDDING_REINDEX_WARNING);
          confirmModal.open();
          const confirmed = await confirmModal.result;
          if (!confirmed) return;
          const result2 = await this.plugin.api.setEmbeddingModel(value);
          if (result2.isErr()) {
            new import_obsidian13.Notice(noticeForResultError(result2.error, MESSAGES.NOTICE_FAILED_EMBEDDING));
            return;
          }
          new import_obsidian13.Notice(MESSAGES.NOTICE_EMBEDDING_UPDATED);
          new import_obsidian13.Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
          void this.plugin.triggerSync();
        });
      }).addButton(
        (btn) => btn.setButtonText(MESSAGES.BUTTON_BROWSE_MORE).onClick(() => {
          new CatalogModal(this.app, this.plugin, MODEL_TASK.EMBEDDING).open();
        })
      );
    }).catch(() => {
      this.renderEmbeddingFallback(container);
    });
  }
  renderRerankerSection(container) {
    Promise.all([
      this.plugin.api.config(),
      this.plugin.api.catalog({ task: MODEL_TASK.RERANK }),
      this.plugin.api.installedModels({ task: MODEL_TASK.RERANK }).catch(() => ({ models: [] }))
    ]).then(([cfg, catalogResult, installedResp]) => {
      const active = typeof cfg.reranker_model === "string" ? cfg.reranker_model : RERANKER_DISABLED_KEY;
      const catalogEntries = catalogResult.isOk() ? catalogResult.value.models.filter((m) => m.task === MODEL_TASK.RERANK) : [];
      this.renderRerankerDropdown(container, active, catalogEntries, installedResp.models);
    }).catch((err3) => {
      if (noticeServerUnreachableIfApplicable(err3)) return;
      this.plugin.journal.record(MESSAGES.NOTICE_RERANKER_LOAD_FAILED, errorMessage(err3, ""));
    });
  }
  renderRerankerDropdown(container, active, catalogEntries, installed) {
    const options = this.buildRerankerOptions(catalogEntries, installed);
    new import_obsidian13.Setting(container).setName(MESSAGES.LABEL_RERANKER_TITLE).setDesc(MESSAGES.DESC_RERANKER_MODEL).addDropdown((dropdown) => {
      for (const [value, label] of options) {
        dropdown.addOption(value, label);
      }
      dropdown.setValue(
        matchModelOption(
          active || RERANKER_DISABLED_KEY,
          options.map(([value]) => value)
        )
      );
      dropdown.onChange(async (value) => {
        await this.handleRerankerChange(value, catalogEntries, installed);
      });
    }).addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_BROWSE_MORE).onClick(() => {
        new CatalogModal(this.app, this.plugin, MODEL_TASK.RERANK).open();
      })
    );
  }
  buildRerankerOptions(catalogEntries, installed) {
    const installedRepos = new Set(installed.map((m) => extractHfRepo(m.name)));
    const isInstalled = (e) => installedRepos.has(e.hf_repo);
    const opts = [[RERANKER_DISABLED_KEY, MESSAGES.LABEL_RERANKER_DISABLED]];
    const localInstalled = catalogEntries.filter((e) => !HOSTED_SOURCES.has(e.source) && isInstalled(e));
    for (const e of localInstalled) opts.push([e.hf_repo, e.display_name]);
    for (const [ref, label] of hostedOptions(catalogEntries)) {
      opts.push([ref, `${label} \u2014 ${MESSAGES.LABEL_RERANKER_HOSTED_GROUP}`]);
    }
    return opts;
  }
  async handleRerankerChange(value, catalogEntries, installed) {
    const installedRepos = new Set(installed.map((m) => extractHfRepo(m.name)));
    const catalogEntry = catalogEntries.find((e) => e.hf_repo === value);
    if (value === RERANKER_DISABLED_KEY || installedRepos.has(value) || catalogEntry !== void 0 && HOSTED_SOURCES.has(catalogEntry.source)) {
      await this.applyRerankerSelection(value);
      return;
    }
    if (catalogEntry) {
      await this.pullAndSetReranker(catalogEntry);
    }
  }
  async applyRerankerSelection(value) {
    const result = await this.plugin.api.setRerankerModel(value);
    if (result.isErr()) {
      new import_obsidian13.Notice(noticeForResultError(result.error, MESSAGES.NOTICE_FAILED_RERANKER));
      return;
    }
    new import_obsidian13.Notice(MESSAGES.NOTICE_RERANKER_UPDATED);
  }
  async pullAndSetReranker(entry) {
    const taskId = this.plugin.taskQueue.enqueue(`Pull ${entry.display_name}`, TASK_TYPE.PULL);
    if (taskId === null) {
      new import_obsidian13.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    const controller = new AbortController();
    this.plugin.taskQueue.registerAbort(taskId, controller);
    const ok2 = await this.streamRerankerPull(taskId, entry, controller.signal);
    if (!ok2) return;
    this.plugin.taskQueue.complete(taskId);
    await this.applyRerankerSelection(entry.hf_repo);
  }
  async streamRerankerPull(taskId, entry, signal) {
    try {
      for await (const event of this.plugin.api.pullModel(entry.hf_repo, "native", signal)) {
        if (event.event === SSE_EVENT.PROGRESS) {
          this.handleRerankerPullProgress(taskId, entry, event.data);
        } else if (event.event === SSE_EVENT.ERROR) {
          this.handleRerankerPullSseError(taskId, entry, event.data);
          return false;
        }
      }
    } catch (err3) {
      this.handleRerankerPullException(taskId, entry, err3);
      return false;
    }
    return true;
  }
  handleRerankerPullProgress(taskId, entry, data) {
    const d = data;
    const pct = percentFromSse(d);
    if (pct !== void 0) {
      this.plugin.taskQueue.update(taskId, pct, entry.display_name, { current: d.current, total: d.total });
    }
  }
  handleRerankerPullSseError(taskId, entry, data) {
    const msg = extractSseErrorMessage(data, MESSAGES.ERROR_UNKNOWN);
    new import_obsidian13.Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${msg}`);
    this.plugin.taskQueue.fail(taskId, msg);
  }
  handleRerankerPullException(taskId, entry, err3) {
    if (err3 instanceof Error && err3.name === ERROR_NAME.ABORT_ERROR) {
      new import_obsidian13.Notice(MESSAGES.NOTICE_PULL_CANCELLED);
      this.plugin.taskQueue.cancel(taskId);
      return;
    }
    const reason = errorMessage(err3, MESSAGES.ERROR_UNKNOWN);
    new import_obsidian13.Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${reason}`);
    this.plugin.taskQueue.fail(taskId, reason);
  }
  renderVisionSection(container) {
    Promise.all([
      this.plugin.api.config(),
      this.plugin.api.catalog({ task: MODEL_TASK.VISION }),
      this.plugin.api.installedModels({ task: MODEL_TASK.VISION }).catch(() => ({ models: [] }))
    ]).then(([cfg, catalogResult, installedResp]) => {
      const active = typeof cfg.vision_model === "string" ? cfg.vision_model : VISION_DISABLED_KEY;
      const catalogEntries = catalogResult.isOk() ? catalogResult.value.models.filter((m) => m.task === MODEL_TASK.VISION) : [];
      this.renderVisionDropdown(container, active, catalogEntries, installedResp.models);
    }).catch((err3) => {
      if (noticeServerUnreachableIfApplicable(err3)) return;
      this.plugin.journal.record(MESSAGES.NOTICE_VISION_LOAD_FAILED, errorMessage(err3, ""));
    });
  }
  renderVisionDropdown(container, active, catalogEntries, installed) {
    const options = this.buildVisionOptions(catalogEntries, installed);
    new import_obsidian13.Setting(container).setName(MESSAGES.LABEL_VISION_TITLE).setDesc(MESSAGES.DESC_VISION_MODEL).addDropdown((dropdown) => {
      for (const [value, label] of options) {
        dropdown.addOption(value, label);
      }
      dropdown.setValue(
        matchModelOption(
          active || VISION_DISABLED_KEY,
          options.map(([value]) => value)
        )
      );
      dropdown.onChange(async (value) => {
        await this.handleVisionChange(value, catalogEntries, installed);
      });
    }).addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_BROWSE_MORE).onClick(() => {
        new CatalogModal(this.app, this.plugin, MODEL_TASK.VISION).open();
      })
    );
  }
  buildVisionOptions(catalogEntries, installed) {
    const installedRepos = new Set(installed.map((m) => extractHfRepo(m.name)));
    const opts = [[VISION_DISABLED_KEY, MESSAGES.LABEL_VISION_DISABLED]];
    const localInstalled = catalogEntries.filter(
      (e) => !HOSTED_SOURCES.has(e.source) && installedRepos.has(e.hf_repo)
    );
    for (const e of localInstalled) opts.push([e.hf_repo, e.display_name]);
    for (const [ref, label] of hostedOptions(catalogEntries)) {
      opts.push([ref, `${label} \u2014 ${MESSAGES.LABEL_VISION_HOSTED_GROUP}`]);
    }
    return opts;
  }
  async handleVisionChange(value, catalogEntries, installed) {
    const installedRepos = new Set(installed.map((m) => extractHfRepo(m.name)));
    const catalogEntry = catalogEntries.find((e) => e.hf_repo === value);
    if (value === VISION_DISABLED_KEY || installedRepos.has(value) || catalogEntry !== void 0 && HOSTED_SOURCES.has(catalogEntry.source)) {
      await this.applyVisionSelection(value);
      return;
    }
    if (catalogEntry) {
      await this.pullAndSetVision(catalogEntry);
    }
  }
  async applyVisionSelection(value) {
    const result = await this.plugin.api.setVisionModel(value);
    if (result.isErr()) {
      new import_obsidian13.Notice(noticeForResultError(result.error, MESSAGES.NOTICE_FAILED_VISION));
      return;
    }
    new import_obsidian13.Notice(MESSAGES.NOTICE_VISION_UPDATED);
  }
  async pullAndSetVision(entry) {
    const taskId = this.plugin.taskQueue.enqueue(`Pull ${entry.display_name}`, TASK_TYPE.PULL);
    if (taskId === null) {
      new import_obsidian13.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    const controller = new AbortController();
    this.plugin.taskQueue.registerAbort(taskId, controller);
    const ok2 = await this.streamVisionPull(taskId, entry, controller.signal);
    if (!ok2) return;
    this.plugin.taskQueue.complete(taskId);
    await this.applyVisionSelection(entry.hf_repo);
  }
  async streamVisionPull(taskId, entry, signal) {
    try {
      for await (const event of this.plugin.api.pullModel(entry.hf_repo, "native", signal)) {
        if (event.event === SSE_EVENT.PROGRESS) {
          this.handleVisionPullProgress(taskId, entry, event.data);
        } else if (event.event === SSE_EVENT.ERROR) {
          this.handleVisionPullSseError(taskId, entry, event.data);
          return false;
        }
      }
    } catch (err3) {
      this.handleVisionPullException(taskId, entry, err3);
      return false;
    }
    return true;
  }
  handleVisionPullProgress(taskId, entry, data) {
    const d = data;
    const pct = percentFromSse(d);
    if (pct !== void 0) {
      this.plugin.taskQueue.update(taskId, pct, entry.display_name, { current: d.current, total: d.total });
    }
  }
  handleVisionPullSseError(taskId, entry, data) {
    const msg = extractSseErrorMessage(data, MESSAGES.ERROR_UNKNOWN);
    new import_obsidian13.Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${msg}`);
    this.plugin.taskQueue.fail(taskId, msg);
  }
  handleVisionPullException(taskId, entry, err3) {
    if (err3 instanceof Error && err3.name === ERROR_NAME.ABORT_ERROR) {
      new import_obsidian13.Notice(MESSAGES.NOTICE_PULL_CANCELLED);
      this.plugin.taskQueue.cancel(taskId);
      return;
    }
    const reason = errorMessage(err3, MESSAGES.ERROR_UNKNOWN);
    new import_obsidian13.Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${reason}`);
    this.plugin.taskQueue.fail(taskId, reason);
  }
  renderEmbeddingFallback(container) {
    new import_obsidian13.Setting(container).setName(MESSAGES.LABEL_EMBEDDING_MODEL).setDesc(MESSAGES.DESC_EMBEDDING_MODEL).addText((text) => {
      text.setPlaceholder(MESSAGES.PLACEHOLDER_DEFAULT).setValue("").onChange(async (value) => {
        const trimmed = value.trim();
        if (trimmed === "") return;
        const confirmModal = new ConfirmModal(this.app, MESSAGES.DESC_EMBEDDING_REINDEX_WARNING);
        confirmModal.open();
        const confirmed = await confirmModal.result;
        if (!confirmed) return;
        const result = await this.plugin.api.setEmbeddingModel(trimmed);
        if (result.isErr()) {
          new import_obsidian13.Notice(noticeForResultError(result.error, MESSAGES.NOTICE_FAILED_EMBEDDING));
          return;
        }
        new import_obsidian13.Notice(MESSAGES.NOTICE_EMBEDDING_UPDATED);
        new import_obsidian13.Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
        void this.plugin.triggerSync();
      });
      this.serverConfigInputs.set("embedding_model", text.inputEl);
    });
  }
  renderCrawlingSettings(containerEl) {
    new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_CRAWLING).setHeading();
    const fields = [
      {
        key: "crawl_max_depth",
        name: MESSAGES.LABEL_CRAWL_MAX_DEPTH,
        desc: MESSAGES.DESC_CRAWL_MAX_DEPTH,
        placeholder: MESSAGES.HINT_CRAWL_BLANK_NO_LIMIT,
        kind: "int",
        nullable: true,
        min: 0
      },
      {
        key: "crawl_max_pages",
        name: MESSAGES.LABEL_CRAWL_MAX_PAGES,
        desc: MESSAGES.DESC_CRAWL_MAX_PAGES,
        placeholder: MESSAGES.HINT_CRAWL_BLANK_NO_LIMIT,
        kind: "int",
        nullable: true,
        min: 1
      },
      {
        key: "crawl_timeout",
        name: MESSAGES.LABEL_CRAWL_TIMEOUT,
        desc: MESSAGES.DESC_CRAWL_TIMEOUT,
        placeholder: MESSAGES.PLACEHOLDER_30,
        kind: "int",
        nullable: false,
        min: 1
      },
      {
        key: "crawl_mean_delay",
        name: MESSAGES.LABEL_CRAWL_MEAN_DELAY,
        desc: MESSAGES.DESC_CRAWL_MEAN_DELAY,
        placeholder: "0.5",
        kind: "float",
        nullable: false,
        min: 0
      },
      {
        key: "crawl_max_delay_range",
        name: MESSAGES.LABEL_CRAWL_MAX_DELAY_RANGE,
        desc: MESSAGES.DESC_CRAWL_MAX_DELAY_RANGE,
        placeholder: "0.5",
        kind: "float",
        nullable: false,
        min: 0
      },
      {
        key: "crawl_concurrent_requests",
        name: MESSAGES.LABEL_CRAWL_CONCURRENT_REQUESTS,
        desc: MESSAGES.DESC_CRAWL_CONCURRENT_REQUESTS,
        placeholder: "3",
        kind: "int",
        nullable: false,
        min: 1
      },
      {
        key: "crawl_retry_on_rate_limit",
        name: MESSAGES.LABEL_CRAWL_RETRY_ON_RATE_LIMIT,
        desc: MESSAGES.DESC_CRAWL_RETRY_ON_RATE_LIMIT,
        kind: "bool"
      },
      {
        key: "crawl_retry_base_delay_min",
        name: MESSAGES.LABEL_CRAWL_RETRY_BASE_DELAY_MIN,
        desc: MESSAGES.DESC_CRAWL_RETRY_BASE_DELAY_MIN,
        placeholder: "1.0",
        kind: "float",
        nullable: false,
        min: 0
      },
      {
        key: "crawl_retry_base_delay_max",
        name: MESSAGES.LABEL_CRAWL_RETRY_BASE_DELAY_MAX,
        desc: MESSAGES.DESC_CRAWL_RETRY_BASE_DELAY_MAX,
        placeholder: "3.0",
        kind: "float",
        nullable: false,
        min: 0
      },
      {
        key: "crawl_retry_max_backoff",
        name: MESSAGES.LABEL_CRAWL_RETRY_MAX_BACKOFF,
        desc: MESSAGES.DESC_CRAWL_RETRY_MAX_BACKOFF,
        placeholder: "30.0",
        kind: "float",
        nullable: false,
        min: 0
      },
      {
        key: "crawl_retry_max_attempts",
        name: MESSAGES.LABEL_CRAWL_RETRY_MAX_ATTEMPTS,
        desc: MESSAGES.DESC_CRAWL_RETRY_MAX_ATTEMPTS,
        placeholder: "3",
        kind: "int",
        nullable: false,
        min: 0
      }
    ];
    for (const field of fields) {
      if (field.kind === "bool") {
        const boolSetting = new import_obsidian13.Setting(containerEl).setName(field.name).setDesc(field.desc).addToggle((toggle) => {
          toggle.onChange(async (value) => {
            if (this.suppressToggleChanges) return;
            try {
              await this.plugin.api.updateConfig({ [field.key]: value });
              new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(field.name));
            } catch {
              new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(field.name));
            }
          });
          this.serverConfigToggles.set(field.key, toggle);
        });
        this.appendResetAffordance(boolSetting, field.key, field.name);
        continue;
      }
      const numField = field;
      const numSetting = new import_obsidian13.Setting(containerEl).setName(numField.name).setDesc(numField.desc).addText((text) => {
        text.setPlaceholder(numField.placeholder).setValue("").onChange(async (value) => {
          const trimmed = value.trim();
          if (trimmed === "") {
            if (!numField.nullable) return;
            try {
              await this.plugin.api.updateConfig({ [numField.key]: null });
              new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(numField.name));
            } catch {
              new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(numField.name));
            }
            return;
          }
          const num = Number(trimmed);
          if (!Number.isFinite(num)) return;
          if (numField.kind === "int" && !Number.isInteger(num)) return;
          if (numField.min !== void 0 && num < numField.min) return;
          try {
            await this.plugin.api.updateConfig({ [numField.key]: num });
            new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(numField.name));
          } catch {
            new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(numField.name));
          }
        });
        this.serverConfigInputs.set(numField.key, text.inputEl);
      });
      this.appendResetAffordance(numSetting, numField.key, numField.name);
    }
    const renderModeContainer = containerEl.createDiv();
    const renderModeSetting = new import_obsidian13.Setting(renderModeContainer).setName(MESSAGES.LABEL_CRAWL_RENDER_MODE).setDesc(MESSAGES.DESC_CRAWL_RENDER_MODE).addDropdown((dropdown) => {
      dropdown.addOption(CRAWL_RENDER_MODE.HTTP, MESSAGES.LABEL_CRAWL_RENDER_MODE_HTTP);
      dropdown.addOption(CRAWL_RENDER_MODE.BROWSER, MESSAGES.LABEL_CRAWL_RENDER_MODE_BROWSER);
      dropdown.setValue(CRAWL_RENDER_MODE.HTTP);
      dropdown.onChange(async (value) => {
        try {
          await this.plugin.api.updateConfig({ [CONFIG_KEY.CRAWL_RENDER_MODE]: value });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_CRAWL_RENDER_MODE));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_CRAWL_RENDER_MODE));
        }
      });
      this.serverConfigDropdowns.set(CONFIG_KEY.CRAWL_RENDER_MODE, dropdown);
    });
    this.appendResetAffordance(renderModeSetting, CONFIG_KEY.CRAWL_RENDER_MODE, MESSAGES.LABEL_CRAWL_RENDER_MODE);
    renderModeContainer.hide();
    this.serverConfigHideableEls.set(CONFIG_KEY.CRAWL_RENDER_MODE, renderModeContainer);
    const patternsSetting = new import_obsidian13.Setting(containerEl).setName(MESSAGES.LABEL_CRAWL_EXCLUDE_PATTERNS).setDesc(MESSAGES.DESC_CRAWL_EXCLUDE_PATTERNS).addTextArea((text) => {
      text.setValue("").onChange(async (value) => {
        const patterns = value.split("\n").map((p) => p.trim()).filter((p) => p.length > 0);
        try {
          await this.plugin.api.updateConfig({ crawl_exclude_patterns: patterns });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_CRAWL_EXCLUDE_PATTERNS));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_CRAWL_EXCLUDE_PATTERNS));
        }
      });
      text.inputEl.addClass("lilbee-crawl-exclude-patterns");
      this.serverConfigTextAreas.set("crawl_exclude_patterns", text.inputEl);
    });
    this.appendResetAffordance(patternsSetting, "crawl_exclude_patterns", MESSAGES.LABEL_CRAWL_EXCLUDE_PATTERNS);
  }
  renderWikiSettings(containerEl) {
    const details = containerEl.createEl("details", { cls: "lilbee-advanced-details lilbee-settings-section" });
    details.createEl("summary", { text: MESSAGES.LABEL_WIKI_SECTION });
    const subSettingsContainer = details.createDiv({ cls: "lilbee-wiki-sub-settings" });
    const enableSetting = new import_obsidian13.Setting(details).setName(MESSAGES.LABEL_WIKI_ENABLE_TOGGLE).setDesc(MESSAGES.DESC_WIKI_ENABLE_TOGGLE).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.wikiEnabled);
      toggle.onChange(async (value) => {
        this.plugin.settings.wikiEnabled = value;
        this.plugin.wikiEnabled = value;
        await this.plugin.saveSettings();
        this.setSubSettingsVisible(subSettingsContainer, value);
      });
    });
    this.appendLocalResetAffordance(enableSetting, "wikiEnabled", MESSAGES.LABEL_WIKI_ENABLE_TOGGLE);
    this.setSubSettingsVisible(subSettingsContainer, this.plugin.settings.wikiEnabled);
    const statusDesc = `Enabled \u2014 ${this.plugin.wikiPageCount} pages, ${this.plugin.wikiDraftCount} drafts`;
    new import_obsidian13.Setting(subSettingsContainer).setName(MESSAGES.LABEL_WIKI_STATUS).setDesc(statusDesc).setDisabled(true);
    const pruneSetting = new import_obsidian13.Setting(subSettingsContainer).setName(MESSAGES.LABEL_WIKI_PRUNE_RAW).setDesc(MESSAGES.DESC_WIKI_PRUNE_RAW).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.wikiPruneRaw);
      toggle.onChange(async (value) => {
        this.plugin.settings.wikiPruneRaw = value;
        await this.plugin.saveSettings();
        try {
          await this.plugin.api.updateConfig({ wiki_prune_raw: value });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_WIKI_PRUNE_RAW));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_WIKI_PRUNE_RAW));
        }
      });
    });
    this.appendDualResetAffordance(pruneSetting, "wiki_prune_raw", "wikiPruneRaw", MESSAGES.LABEL_WIKI_PRUNE_RAW);
    const faithSetting = new import_obsidian13.Setting(subSettingsContainer).setName(MESSAGES.LABEL_WIKI_FAITHFULNESS).setDesc(MESSAGES.DESC_WIKI_FAITHFULNESS).addSlider((slider) => {
      slider.setLimits(0, 1, 0.05).setValue(this.plugin.settings.wikiFaithfulnessThreshold).onChange(async (value) => {
        this.plugin.settings.wikiFaithfulnessThreshold = value;
        await this.plugin.saveSettings();
        try {
          await this.plugin.api.updateConfig({ wiki_embedding_faithfulness_threshold: value });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_WIKI_FAITHFULNESS));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_WIKI_FAITHFULNESS));
        }
      });
    });
    this.appendDualResetAffordance(
      faithSetting,
      "wiki_embedding_faithfulness_threshold",
      "wikiFaithfulnessThreshold",
      MESSAGES.LABEL_WIKI_FAITHFULNESS
    );
    const searchModeSetting = new import_obsidian13.Setting(subSettingsContainer).setName(MESSAGES.LABEL_WIKI_SEARCH_MODE).setDesc(MESSAGES.DESC_WIKI_SEARCH_MODE).addDropdown((dropdown) => {
      dropdown.addOption(SEARCH_CHUNK_TYPE.ALL, MESSAGES.LABEL_SEARCH_ALL).addOption(SEARCH_CHUNK_TYPE.WIKI, MESSAGES.LABEL_SEARCH_WIKI).addOption(SEARCH_CHUNK_TYPE.RAW, MESSAGES.LABEL_SEARCH_RAW).setValue(this.plugin.settings.searchChunkType).onChange(async (value) => {
        this.plugin.settings.searchChunkType = value;
        await this.plugin.saveSettings();
      });
    });
    this.appendLocalResetAffordance(searchModeSetting, "searchChunkType", MESSAGES.LABEL_WIKI_SEARCH_MODE);
    const syncSetting = new import_obsidian13.Setting(subSettingsContainer).setName(MESSAGES.LABEL_WIKI_SYNC_TO_VAULT).setDesc(MESSAGES.DESC_WIKI_SYNC_TO_VAULT).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.wikiSyncToVault);
      toggle.onChange(async (value) => {
        this.plugin.settings.wikiSyncToVault = value;
        await this.plugin.saveSettings();
        if (value && this.plugin.wikiEnabled) {
          this.plugin.initWikiSync();
          void this.plugin.reconcileWiki();
        } else {
          this.plugin.wikiSync = null;
        }
      });
    });
    this.appendLocalResetAffordance(syncSetting, "wikiSyncToVault", MESSAGES.LABEL_WIKI_SYNC_TO_VAULT);
    const folderSetting = new import_obsidian13.Setting(subSettingsContainer).setName(MESSAGES.LABEL_WIKI_VAULT_FOLDER).setDesc(MESSAGES.DESC_WIKI_VAULT_FOLDER).addText((text) => {
      text.setValue(this.plugin.settings.wikiVaultFolder);
      text.onChange(async (value) => {
        this.plugin.settings.wikiVaultFolder = value || "lilbee-wiki";
        await this.plugin.saveSettings();
        if (this.plugin.settings.wikiSyncToVault && this.plugin.wikiEnabled) {
          this.plugin.initWikiSync();
        }
      });
    });
    this.appendLocalResetAffordance(folderSetting, "wikiVaultFolder", MESSAGES.LABEL_WIKI_VAULT_FOLDER);
    this.renderConfigToggle(
      subSettingsContainer,
      "wiki_auto_update",
      MESSAGES.LABEL_WIKI_AUTO_UPDATE,
      MESSAGES.DESC_WIKI_AUTO_UPDATE
    );
    const stubRefs = this.renderHideableNumberField(
      subSettingsContainer,
      "wiki_stub_max_chunk_refs",
      MESSAGES.LABEL_WIKI_STUB_MAX_CHUNK_REFS,
      MESSAGES.DESC_WIKI_STUB_MAX_CHUNK_REFS,
      { integer: true, min: 1 }
    );
    this.appendResetAffordance(stubRefs, "wiki_stub_max_chunk_refs", MESSAGES.LABEL_WIKI_STUB_MAX_CHUNK_REFS);
    const entityPrompt = new import_obsidian13.Setting(subSettingsContainer).setName(MESSAGES.LABEL_WIKI_ENTITY_PAGE_PROMPT).setDesc(MESSAGES.DESC_WIKI_ENTITY_PAGE_PROMPT).addTextArea((area) => {
      area.onChange(async (value) => {
        const trimmed = value.trim();
        try {
          await this.plugin.api.updateConfig({
            wiki_entity_page_prompt: trimmed === "" ? null : trimmed
          });
          new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_WIKI_ENTITY_PAGE_PROMPT));
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_WIKI_ENTITY_PAGE_PROMPT));
        }
      });
      this.serverConfigInputs.set("wiki_entity_page_prompt", area.inputEl);
    });
    this.appendResetAffordance(entityPrompt, "wiki_entity_page_prompt", MESSAGES.LABEL_WIKI_ENTITY_PAGE_PROMPT);
    new import_obsidian13.Setting(subSettingsContainer).setName(MESSAGES.LABEL_WIKI_RUN_LINT).setDesc(MESSAGES.DESC_WIKI_RUN_LINT).addButton((btn) => {
      btn.setButtonText(MESSAGES.LABEL_WIKI_RUN_LINT);
      btn.onClick(() => {
        void this.plugin.runWikiLint();
      });
    });
    new import_obsidian13.Setting(subSettingsContainer).setName(MESSAGES.LABEL_WIKI_RUN_PRUNE).setDesc(MESSAGES.DESC_WIKI_RUN_PRUNE).addButton((btn) => {
      btn.setButtonText(MESSAGES.LABEL_WIKI_RUN_PRUNE);
      btn.onClick(() => {
        void this.plugin.runWikiPrune();
      });
    });
  }
  setSubSettingsVisible(container, visible) {
    container.style.display = visible ? "" : "none";
  }
  renderAdvancedSettings(containerEl) {
    const details = containerEl.createEl("details", { cls: "lilbee-advanced-details lilbee-settings-section" });
    details.createEl("summary", { text: MESSAGES.LABEL_ADVANCED });
    details.createEl("p", {
      text: MESSAGES.LABEL_ADVANCED_HELP,
      cls: "setting-item-description"
    });
    const storeSetting = new import_obsidian13.Setting(details).setName(MESSAGES.LABEL_STORE_CONTENT_IN_VAULT).setDesc(MESSAGES.DESC_STORE_CONTENT_IN_VAULT).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.storeContentInVault);
      toggle.setDisabled(this.plugin.settings.serverMode !== SERVER_MODE.MANAGED);
      toggle.onChange(async (value) => {
        this.plugin.settings.storeContentInVault = value;
        await this.plugin.saveSettings();
        if (value) {
          void this.plugin.configureManagedStorage();
        }
      });
    });
    if (this.plugin.settings.serverMode !== SERVER_MODE.MANAGED) {
      storeSetting.settingEl.addClass("lilbee-setting-disabled");
    }
    this.renderRerankCandidatesField(details);
    const llmSetting = new import_obsidian13.Setting(details).setName(MESSAGES.LABEL_LLM_PROVIDER).setDesc(MESSAGES.DESC_LLM_PROVIDER).addDropdown((dropdown) => {
      dropdown.addOption("auto", MESSAGES.DESC_LLM_PROVIDER_AUTO).addOption("llama-cpp", MESSAGES.DESC_LLM_PROVIDER_LOCAL).addOption("litellm", MESSAGES.DESC_LLM_PROVIDER_EXTERNAL).setValue("auto").onChange(async (value) => {
        try {
          await this.plugin.api.updateConfig({ llm_provider: value });
          new import_obsidian13.Notice(MESSAGES.NOTICE_LLM_UPDATED);
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_LLM);
        }
      });
      this.serverConfigInputs.set("llm_provider", dropdown.selectEl);
    });
    this.appendResetAffordance(llmSetting, "llm_provider", MESSAGES.LABEL_LLM_PROVIDER);
    const apiKeyFields = [
      {
        label: MESSAGES.LABEL_OPENAI_API_KEY,
        desc: MESSAGES.DESC_OPENAI_API_KEY,
        configKey: "openai_api_key",
        provider: "openai"
      },
      {
        label: MESSAGES.LABEL_ANTHROPIC_API_KEY,
        desc: MESSAGES.DESC_ANTHROPIC_API_KEY,
        configKey: "anthropic_api_key",
        provider: "anthropic"
      },
      {
        label: MESSAGES.LABEL_GEMINI_API_KEY,
        desc: MESSAGES.DESC_GEMINI_API_KEY,
        configKey: "gemini_api_key",
        provider: "gemini"
      }
    ];
    const apiKeysContainer = details.createDiv({ cls: "lilbee-api-keys-section" });
    this.apiKeysContainerEl = apiKeysContainer;
    for (const apiField of apiKeyFields) {
      const setting = new import_obsidian13.Setting(apiKeysContainer).setName(apiField.label).setDesc(apiField.desc).addText((text) => {
        text.setPlaceholder(MESSAGES.PLACEHOLDER_SK).setValue("");
        text.inputEl.type = "password";
        const saveKey = async () => {
          const trimmed = text.inputEl.value.trim();
          if (trimmed === "") return;
          try {
            await this.plugin.api.updateConfig({ [apiField.configKey]: trimmed });
            this.plugin.api.invalidateCapability(CAPABILITY.API_KEYS);
            new import_obsidian13.Notice(MESSAGES.NOTICE_API_KEY_SAVED);
          } catch {
            new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_SAVE_KEY);
          }
        };
        text.inputEl.addEventListener("blur", () => void saveKey());
      });
      setting.settingEl.setAttribute("data-lilbee-api-key", apiField.provider);
    }
    new import_obsidian13.Setting(details).setName(MESSAGES.LABEL_HF_TOKEN).setDesc(MESSAGES.DESC_HF_TOKEN).addText((text) => {
      text.setPlaceholder(MESSAGES.PLACEHOLDER_HF_TOKEN).setValue(this.plugin.getSharedHfToken()).onChange(async (value) => {
        const trimmed = value.trim();
        this.plugin.setSharedHfToken(trimmed);
        try {
          await this.plugin.api.updateConfig({ hf_token: trimmed });
          new import_obsidian13.Notice(MESSAGES.NOTICE_HF_TOKEN_SAVED);
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_HF_TOKEN);
        }
      });
      text.inputEl.type = "password";
    });
    const localServerFields = [
      {
        label: MESSAGES.LABEL_OLLAMA_BASE_URL,
        desc: MESSAGES.DESC_OLLAMA_BASE_URL,
        configKey: "ollama_base_url",
        placeholder: "http://localhost:11434"
      },
      {
        label: MESSAGES.LABEL_LM_STUDIO_BASE_URL,
        desc: MESSAGES.DESC_LM_STUDIO_BASE_URL,
        configKey: "lm_studio_base_url",
        placeholder: "http://localhost:1234/v1"
      }
    ];
    for (const field of localServerFields) {
      const setting = new import_obsidian13.Setting(details).setName(field.label).setDesc(field.desc).addText((text) => {
        text.setPlaceholder(field.placeholder).setValue("").onChange(async (value) => {
          const trimmed = value.trim();
          if (trimmed === "") return;
          try {
            await this.plugin.api.updateConfig({ [field.configKey]: trimmed });
            new import_obsidian13.Notice(MESSAGES.NOTICE_LOCAL_SERVER_URL_UPDATED);
          } catch {
            new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_LOCAL_SERVER_URL);
          }
        });
        this.serverConfigInputs.set(field.configKey, text.inputEl);
      });
      this.appendResetAffordance(setting, field.configKey, field.label);
    }
    new import_obsidian13.Setting(details).setName(MESSAGES.LABEL_RESET_ALL_SETTINGS).setDesc(MESSAGES.DESC_RESET_ALL_SETTINGS).addButton(
      (btn) => btn.setButtonText(MESSAGES.BUTTON_RESET_ALL).setClass("mod-warning").onClick(async () => {
        const confirm = new ConfirmModal(this.app, MESSAGES.CONFIRM_RESET_ALL_SETTINGS);
        confirm.open();
        const confirmed = await confirm.result;
        if (!confirmed) return;
        const payload = { ...this.configDefaults };
        for (const k of CREDENTIAL_FIELDS) delete payload[k];
        if (Object.keys(payload).length === 0) return;
        try {
          await this.plugin.api.updateConfig(payload);
          new import_obsidian13.Notice(MESSAGES.NOTICE_SETTINGS_RESET);
          this.render();
        } catch {
          new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_RESET_ALL);
        }
      })
    );
  }
  async checkEndpoint(url, statusEl) {
    statusEl.empty();
    statusEl.classList.remove("lilbee-health-ok", "lilbee-health-error");
    const dot = statusEl.createDiv({ cls: "lilbee-health-dot" });
    const ok2 = await LilbeeClient.probe(url, CHECK_TIMEOUT_MS, this.plugin.readCurrentToken());
    dot.classList.add(ok2 ? "is-ok" : "is-error");
    statusEl.classList.add(ok2 ? "lilbee-health-ok" : "lilbee-health-error");
  }
  async loadModels(container) {
    container.empty();
    const chatContainer = container.createDiv({ cls: "lilbee-chat-container" });
    this.renderChatSection(chatContainer);
    const embeddingContainer = container.createDiv({ cls: "lilbee-embedding-container" });
    this.loadEmbeddingDropdown(embeddingContainer);
    const visionContainer = container.createDiv({ cls: "lilbee-vision-container" });
    this.renderVisionSection(visionContainer);
    const rerankerContainer = container.createDiv({ cls: "lilbee-reranker-container" });
    this.renderRerankerSection(rerankerContainer);
  }
  renderChatSection(container) {
    Promise.all([
      this.plugin.api.config(),
      this.plugin.api.catalog({ task: MODEL_TASK.CHAT }),
      this.plugin.api.installedModels({ task: MODEL_TASK.CHAT }).catch(() => ({ models: [] }))
    ]).then(([cfg, catalogResult, installedResp]) => {
      const active = typeof cfg.chat_model === "string" ? cfg.chat_model : "";
      const catalogEntries = catalogResult.isOk() ? catalogResult.value.models.filter((m) => m.task === MODEL_TASK.CHAT) : [];
      this.renderChatPicker(container, active, catalogEntries, installedResp.models);
    }).catch(() => {
    });
  }
  renderChatPicker(container, active, catalogEntries, installed) {
    const section = container.createDiv("lilbee-model-section");
    new import_obsidian13.Setting(section).setName(MESSAGES.LABEL_CHAT_MODEL).setHeading();
    const activeSetting = new import_obsidian13.Setting(section).setName(`${MESSAGES.LABEL_ACTIVE} chat model`).setDesc(displayLabelForRef(active) || MESSAGES.LABEL_NOT_SET);
    const options = this.buildChatOptions(catalogEntries, installed);
    activeSetting.addDropdown((dropdown) => {
      for (const [value, label] of options) {
        dropdown.addOption(value, label);
      }
      dropdown.setValue(
        matchModelOption(
          active,
          options.map(([value]) => value)
        )
      );
      dropdown.onChange(async (value) => {
        if (value === SEPARATOR_KEY) return;
        await this.handleChatChange(value, catalogEntries);
      });
    });
    const catalogEl = section.createDiv("lilbee-model-catalog");
    const table = catalogEl.createEl("table");
    const header = table.createEl("tr");
    header.createEl("th", { text: MESSAGES.LABEL_MODEL });
    header.createEl("th", { text: MESSAGES.LABEL_SIZE });
    header.createEl("th", { text: MESSAGES.LABEL_DESCRIPTION });
    header.createEl("th", { text: "" });
    for (const entry of catalogEntries) {
      this.renderChatCatalogRow(table, entry, active);
    }
  }
  buildChatOptions(catalogEntries, installed) {
    const installedRepos = new Set(installed.map((m) => extractHfRepo(m.name)));
    const opts = [];
    const featuredInstalled = catalogEntries.filter((e) => installedRepos.has(e.hf_repo));
    for (const entry of featuredInstalled) {
      const sourceTag = HOSTED_SOURCES.has(entry.source) ? ` [${entry.provider ?? entry.source}]` : "";
      opts.push([entry.hf_repo, `${entry.display_name}${sourceTag}`]);
    }
    for (const [ref, label] of hostedOptions(catalogEntries)) {
      if (!installedRepos.has(ref)) opts.push([ref, label]);
    }
    const featuredRepos = new Set(catalogEntries.map((e) => e.hf_repo));
    const otherInstalled = installed.filter((m) => !featuredRepos.has(extractHfRepo(m.name))).sort((a, b) => a.name.localeCompare(b.name));
    if (otherInstalled.length > 0) {
      opts.push([SEPARATOR_KEY, SEPARATOR_LABEL]);
      for (const m of otherInstalled) {
        opts.push([m.name, displayLabelForRef(m.name)]);
      }
    }
    return opts;
  }
  async handleChatChange(value, catalogEntries) {
    const featuredEntry = catalogEntries.find((e) => e.hf_repo === value);
    if (featuredEntry && !featuredEntry.installed) {
      const modal = new ConfirmPullModal(this.app, {
        displayName: featuredEntry.display_name,
        sizeGb: featuredEntry.size_gb,
        minRamGb: featuredEntry.min_ram_gb,
        systemMemGb: getRelevantSystemMemoryGB(this.plugin.settings.serverMode)
      });
      modal.open();
      const confirmed = await modal.result;
      if (!confirmed) return;
      await this.pullAndSetChat(featuredEntry);
      return;
    }
    const label = featuredEntry?.display_name ?? displayLabelForRef(value);
    await this.applyChatSelection(value, label);
  }
  async applyChatSelection(ref, label) {
    const result = await this.plugin.api.setChatModel(ref);
    if (result.isErr()) {
      new import_obsidian13.Notice(noticeForResultError(result.error, MESSAGES.NOTICE_FAILED_SET_MODEL(MODEL_TASK.CHAT)));
      return;
    }
    new import_obsidian13.Notice(MESSAGES.NOTICE_SET_MODEL(MESSAGES.LABEL_CHAT_MODEL, label || MESSAGES.LABEL_NOT_SET.toLowerCase()));
    void this.plugin.fetchActiveModel();
    this.render();
  }
  async pullAndSetChat(entry) {
    const ok2 = await this.streamChatPull(entry);
    if (!ok2) return;
    const setResult = await this.plugin.api.setChatModel(entry.hf_repo);
    if (setResult.isErr()) {
      new import_obsidian13.Notice(
        noticeForResultError(setResult.error, MESSAGES.ERROR_SET_MODEL.replace("{model}", entry.display_name))
      );
    } else {
      new import_obsidian13.Notice(MESSAGES.NOTICE_MODEL_ACTIVATED_FULL(entry.display_name));
    }
    void this.plugin.fetchActiveModel();
    this.render();
  }
  async streamChatPull(entry) {
    const taskId = this.plugin.taskQueue.enqueue(`Pull ${entry.display_name}`, TASK_TYPE.PULL);
    if (taskId === null) {
      new import_obsidian13.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return false;
    }
    const controller = new AbortController();
    this.plugin.taskQueue.registerAbort(taskId, controller);
    try {
      for await (const event of this.plugin.api.pullModel(entry.hf_repo, "native", controller.signal)) {
        if (event.event === SSE_EVENT.PROGRESS) {
          const d = event.data;
          const pct = percentFromSse(d);
          if (pct !== void 0) {
            this.plugin.taskQueue.update(taskId, pct, entry.display_name, {
              current: d.current,
              total: d.total
            });
          }
        } else if (event.event === SSE_EVENT.ERROR) {
          const msg = extractSseErrorMessage(event.data, MESSAGES.ERROR_UNKNOWN);
          new import_obsidian13.Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${msg}`);
          this.plugin.taskQueue.fail(taskId, msg);
          return false;
        }
      }
    } catch (err3) {
      if (err3 instanceof Error && err3.name === ERROR_NAME.ABORT_ERROR) {
        new import_obsidian13.Notice(MESSAGES.NOTICE_PULL_CANCELLED);
        this.plugin.taskQueue.cancel(taskId);
      } else {
        const reason = errorMessage(err3, MESSAGES.ERROR_UNKNOWN);
        new import_obsidian13.Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${reason}`);
        this.plugin.taskQueue.fail(taskId, reason);
      }
      return false;
    }
    this.plugin.taskQueue.complete(taskId);
    return true;
  }
  renderChatCatalogRow(table, entry, active) {
    const row = table.createEl("tr");
    row.createEl("td", { text: entry.display_name });
    row.createEl("td", { text: `${entry.size_gb} GB` });
    row.createEl("td", { text: entry.description });
    const actionCell = row.createEl("td");
    const actions = actionCell.createDiv({ cls: "lilbee-model-actions" });
    if (entry.installed) {
      actions.createSpan({ text: MESSAGES.LABEL_INSTALLED, cls: "lilbee-installed" });
      const deleteBtn = actions.createEl("button", { cls: "lilbee-model-delete" });
      (0, import_obsidian13.setIcon)(deleteBtn, "trash-2");
      deleteBtn.setAttribute("aria-label", MESSAGES.LABEL_DELETE_MODEL);
      deleteBtn.addEventListener("click", () => void this.deleteChatEntry(deleteBtn, entry, active));
    } else {
      const btn = actions.createEl("button", { text: MESSAGES.BUTTON_PULL });
      btn.addEventListener("click", () => void this.pullAndSetChat(entry));
    }
  }
  async deleteChatEntry(btn, entry, active) {
    const taskId = this.plugin.taskQueue.enqueue(`Remove ${entry.display_name}`, TASK_TYPE.DELETE);
    if (taskId === null) {
      new import_obsidian13.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    btn.disabled = true;
    this.plugin.taskQueue.update(taskId, -1, entry.display_name);
    const result = await this.plugin.api.deleteModel(entry.hf_repo, entry.source);
    if (result.isErr()) {
      new import_obsidian13.Notice(
        noticeForResultError(result.error, MESSAGES.ERROR_DELETE_MODEL.replace("{model}", entry.display_name))
      );
      this.plugin.taskQueue.fail(taskId, errorMessage(result.error, result.error.message));
      btn.disabled = false;
      return;
    }
    this.plugin.taskQueue.complete(taskId);
    new import_obsidian13.Notice(MESSAGES.NOTICE_REMOVED(entry.display_name));
    if (extractHfRepo(active) === entry.hf_repo) {
      const clearResult = await this.plugin.api.setChatModel("");
      if (clearResult.isOk()) {
        this.plugin.activeModel = "";
      }
    }
    void this.plugin.fetchActiveModel();
    const modelsContainer = this.containerEl.querySelector(`.${CLS_MODELS_CONTAINER}`);
    if (modelsContainer) {
      await this.loadModels(modelsContainer);
    }
  }
  renderRerankCandidatesField(container) {
    const patch = debounce((...args) => {
      const num = args[0];
      void this.patchRerankCandidates(num);
    }, DEBOUNCE_MS);
    new import_obsidian13.Setting(container).setName(MESSAGES.LABEL_RERANKER_CANDIDATES).setDesc(MESSAGES.DESC_RERANKER_CANDIDATES).addText((text) => {
      text.setPlaceholder(MESSAGES.PLACEHOLDER_RERANK_CANDIDATES).setValue("").onChange((value) => {
        const trimmed = value.trim();
        if (trimmed === "") return;
        const num = parseInt(trimmed, 10);
        if (isNaN(num) || num < RERANK_CANDIDATES_MIN || num > RERANK_CANDIDATES_MAX) return;
        patch.run(num);
      });
      this.serverConfigInputs.set("rerank_candidates", text.inputEl);
    });
  }
  async patchRerankCandidates(num) {
    try {
      await this.plugin.api.updateConfig({ rerank_candidates: num });
      new import_obsidian13.Notice(MESSAGES.NOTICE_FIELD_UPDATED(MESSAGES.LABEL_RERANKER_CANDIDATES));
    } catch {
      new import_obsidian13.Notice(MESSAGES.NOTICE_FAILED_UPDATE(MESSAGES.LABEL_RERANKER_CANDIDATES));
    }
  }
};
function appendStorageRow(parent, label, bytes, detail) {
  const row = parent.createDiv({ cls: "lilbee-storage-row" });
  row.createSpan({ text: label, cls: "lilbee-storage-row-label" });
  row.createSpan({ text: formatDiskSize(bytes), cls: "lilbee-storage-row-bytes" });
  if (detail) row.createSpan({ text: detail, cls: "lilbee-storage-row-detail" });
}

// src/views/agent-picker-modal.ts
var import_obsidian14 = require("obsidian");
var AGENT_PICKER_RESULT = {
  CONNECT: "connect",
  DISMISS: "dismiss"
};
var asInput = (el) => el;
var CARD_ORDER = [AGENT_CLIENT.OPENCODE, AGENT_CLIENT.CLAUDE, AGENT_CLIENT.HERMES];
var CARD_DESC = {
  [AGENT_CLIENT.OPENCODE]: MESSAGES.AGENT_PICKER_OPENCODE_DESC,
  [AGENT_CLIENT.CLAUDE]: MESSAGES.AGENT_PICKER_CLAUDE_DESC,
  [AGENT_CLIENT.HERMES]: MESSAGES.AGENT_PICKER_HERMES_DESC
};
var AgentPickerModal = class extends import_obsidian14.Modal {
  constructor(app, detections, claudianInstalled) {
    super(app);
    this.detections = detections;
    this.claudianInstalled = claudianInstalled;
    bindEscapeToClose(this);
  }
  detections;
  claudianInstalled;
  resolver = null;
  resolved = false;
  selected = null;
  remember = true;
  cards = /* @__PURE__ */ new Map();
  /** Populated by renderFooter during onOpen, before the first select() call. */
  connectBtn;
  openPicker() {
    return new Promise((resolve2) => {
      this.resolver = resolve2;
      this.open();
    });
  }
  onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("lilbee-agent-picker");
    root.createEl("h3", { text: MESSAGES.AGENT_PICKER_TITLE });
    root.createEl("p", { cls: "lilbee-agent-picker-subtitle", text: MESSAGES.AGENT_PICKER_SUBTITLE });
    const cards = root.createDiv({ cls: "lilbee-agent-picker-cards" });
    for (const client of CARD_ORDER) {
      this.renderCard(cards, client);
    }
    this.renderRemember(root);
    this.renderFooter(root);
    this.select(CARD_ORDER.find((client) => this.isDetected(client)) ?? null);
  }
  onClose() {
    this.decide({ kind: AGENT_PICKER_RESULT.DISMISS });
  }
  isDetected(client) {
    return this.detections.some((d) => d.client === client && d.cli_detected);
  }
  renderCard(parent, client) {
    const detected = this.isDetected(client);
    const card = parent.createDiv({
      cls: `lilbee-agent-picker-card${detected ? "" : " is-unavailable"}`
    });
    const head = card.createDiv({ cls: "lilbee-agent-picker-card-head" });
    head.createEl("strong", { text: AGENT_LABELS[client] });
    if (client === AGENT_CLIENT.OPENCODE && this.claudianInstalled) {
      head.createSpan({ cls: "lilbee-agent-picker-badge", text: MESSAGES.AGENT_PICKER_BADGE_CLAUDIAN });
    }
    if (!detected) {
      head.createSpan({ cls: "lilbee-agent-picker-missing", text: MESSAGES.AGENT_PICKER_NOT_DETECTED });
    }
    card.createEl("p", { text: CARD_DESC[client] });
    this.cards.set(client, card);
    if (!detected) return;
    card.addEventListener("click", () => this.select(client));
  }
  renderRemember(root) {
    const label = root.createEl("label", { cls: "lilbee-agent-picker-remember" });
    const input = label.createEl("input", { attr: { type: "checkbox" } });
    asInput(input).checked = this.remember;
    input.addEventListener("change", () => {
      this.remember = asInput(input).checked;
    });
    label.createSpan({ text: MESSAGES.AGENT_PICKER_REMEMBER });
  }
  renderFooter(root) {
    const foot = root.createDiv({ cls: "lilbee-agent-picker-foot" });
    const notNow = foot.createEl("button", { text: MESSAGES.BUTTON_AGENT_NOT_NOW });
    notNow.addEventListener("click", () => this.decide({ kind: AGENT_PICKER_RESULT.DISMISS }));
    const connect = foot.createEl("button", { cls: "mod-cta" });
    connect.addEventListener("click", () => {
      if (this.selected === null) return;
      this.decide({
        kind: AGENT_PICKER_RESULT.CONNECT,
        client: this.selected,
        remember: this.remember
      });
    });
    this.connectBtn = connect;
  }
  select(client) {
    this.selected = client;
    for (const [key, card] of this.cards) {
      card.toggleClass("selected", key === client);
    }
    this.connectBtn.disabled = client === null;
    this.connectBtn.setText(
      client === null ? MESSAGES.BUTTON_AGENT_CONNECT_NONE : MESSAGES.BUTTON_AGENT_CONNECT(AGENT_LABELS[client])
    );
  }
  decide(result) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolver?.(result);
    this.close();
  }
};

// src/views/managed-consent-modal.ts
var import_obsidian15 = require("obsidian");
var ManagedConsentModal = class extends import_obsidian15.Modal {
  constructor(app, includeDev) {
    super(app);
    this.includeDev = includeDev;
  }
  includeDev;
  resolver = null;
  resolved = false;
  /** Populated synchronously by renderManagedCard during onOpen, before any helper reads it. */
  provBody;
  openConsent() {
    return new Promise((resolve2) => {
      this.resolver = resolve2;
      this.open();
    });
  }
  onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("lilbee-managed-consent");
    this.renderHeader(root);
    const paths = root.createDiv({ cls: "lilbee-managed-consent-paths" });
    this.renderManagedCard(paths);
    this.renderExternalCard(paths);
    this.renderFooter(root);
    void this.fetchProvenance();
  }
  onClose() {
    if (!this.resolved) {
      this.resolved = true;
      this.resolver?.({ kind: MANAGED_CONSENT_RESULT.CANCEL });
    }
  }
  resolveAndClose(result) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolver?.(result);
    this.close();
  }
  renderHeader(root) {
    const head = root.createDiv({ cls: "lilbee-managed-consent-head" });
    const beeWrap = head.createDiv({ cls: "lilbee-managed-consent-bee" });
    beeWrap.createDiv({ cls: "lilbee-managed-consent-bee-glow" });
    const bee = beeWrap.createDiv({ cls: "lilbee-managed-consent-bee-mark" });
    (0, import_obsidian15.setIcon)(bee, "sparkles");
    head.createDiv({ cls: "lilbee-managed-consent-title", text: MESSAGES.MANAGED_CONSENT_TITLE });
    head.createDiv({ cls: "lilbee-managed-consent-subtitle", text: MESSAGES.MANAGED_CONSENT_SUBTITLE });
  }
  renderManagedCard(paths) {
    const card = paths.createDiv({
      cls: "lilbee-managed-consent-card lilbee-managed-consent-card-managed"
    });
    card.createDiv({
      cls: "lilbee-managed-consent-pill",
      text: MESSAGES.MANAGED_CONSENT_PILL_RECOMMENDED
    });
    card.createEl("h4", { text: MESSAGES.MANAGED_CONSENT_CARD_MANAGED_TITLE });
    card.createEl("p", {
      cls: "lilbee-managed-consent-card-desc",
      text: MESSAGES.MANAGED_CONSENT_CARD_MANAGED_DESC
    });
    this.provBody = card.createDiv({ cls: "lilbee-managed-consent-prov" });
    this.renderProvLabel();
    this.provBody.createDiv({
      cls: "lilbee-managed-consent-prov-pending",
      text: MESSAGES.MANAGED_CONSENT_PROV_PENDING
    });
  }
  renderProvLabel() {
    const label = this.provBody.createDiv({ cls: "lilbee-managed-consent-prov-label" });
    const ghIcon = label.createSpan({ cls: "lilbee-managed-consent-gh" });
    (0, import_obsidian15.setIcon)(ghIcon, "github");
    label.createSpan({ text: " " + MESSAGES.MANAGED_CONSENT_PROV_LABEL });
  }
  renderProvResolved(release) {
    this.provBody.empty();
    this.renderProvLabel();
    const repoLine = this.provBody.createDiv({ cls: "lilbee-managed-consent-prov-repo" });
    const repoLink = repoLine.createEl("a", { text: `github.com/${GITHUB_REPO}` });
    repoLink.setAttribute("href", LILBEE_GITHUB_REPO_URL);
    repoLink.setAttribute("target", "_blank");
    repoLine.createSpan({
      cls: "lilbee-managed-consent-prov-at",
      text: ` @ ${release.tag}`
    });
    const asset = this.provBody.createDiv({ cls: "lilbee-managed-consent-prov-asset" });
    asset.createSpan({
      cls: "lilbee-managed-consent-prov-asset-name",
      text: safeAssetName(release.variant)
    });
    asset.createSpan({
      cls: "lilbee-managed-consent-prov-asset-size",
      text: ` \xB7 ${formatMb(release.sizeBytes)} \xB7 ${MESSAGES.MANAGED_CONSENT_PROV_ONE_TIME}`
    });
    const notes = this.provBody.createEl("a", {
      cls: "lilbee-managed-consent-prov-notes",
      text: MESSAGES.MANAGED_CONSENT_PROV_RELEASE_NOTES
    });
    notes.setAttribute("href", `${LILBEE_GITHUB_REPO_URL}/releases/tag/${release.tag}`);
    notes.setAttribute("target", "_blank");
  }
  renderProvFailed() {
    this.provBody.empty();
    this.renderProvLabel();
    const repoLine = this.provBody.createDiv({ cls: "lilbee-managed-consent-prov-repo" });
    const repoLink = repoLine.createEl("a", { text: `github.com/${GITHUB_REPO}` });
    repoLink.setAttribute("href", LILBEE_GITHUB_REPO_URL);
    repoLink.setAttribute("target", "_blank");
    this.provBody.createDiv({
      cls: "lilbee-managed-consent-prov-failed",
      text: MESSAGES.MANAGED_CONSENT_PROV_FAILED
    });
  }
  async fetchProvenance() {
    try {
      const release = await getLatestRelease(this.includeDev);
      if (!this.resolved) this.renderProvResolved(release);
    } catch {
      if (!this.resolved) this.renderProvFailed();
    }
  }
  renderExternalCard(paths) {
    const card = paths.createDiv({
      cls: "lilbee-managed-consent-card lilbee-managed-consent-card-external"
    });
    card.createEl("h4", { text: MESSAGES.MANAGED_CONSENT_CARD_EXTERNAL_TITLE });
    card.createEl("p", {
      cls: "lilbee-managed-consent-card-desc",
      text: MESSAGES.MANAGED_CONSENT_CARD_EXTERNAL_DESC
    });
    const ins = card.createDiv({ cls: "lilbee-managed-consent-card-ins" });
    ins.createSpan({ text: "\u2192 " });
    ins.createSpan({
      cls: "lilbee-managed-consent-configure-link",
      text: MESSAGES.MANAGED_CONSENT_CONFIGURE_LINK
    });
    card.createDiv({
      cls: "lilbee-managed-consent-card-hint",
      text: MESSAGES.MANAGED_CONSENT_CARD_EXTERNAL_HINT
    });
    card.addEventListener("click", () => this.resolveAndClose({ kind: MANAGED_CONSENT_RESULT.EXTERNAL }));
  }
  renderFooter(root) {
    const foot = root.createDiv({ cls: "lilbee-managed-consent-foot" });
    const cancel = foot.createEl("button", {
      cls: "lilbee-managed-consent-btn-cancel",
      text: MESSAGES.MANAGED_CONSENT_BTN_CANCEL
    });
    cancel.addEventListener("click", () => this.resolveAndClose({ kind: MANAGED_CONSENT_RESULT.CANCEL }));
    const dl = foot.createEl("button", {
      cls: "lilbee-managed-consent-btn-download mod-cta",
      text: MESSAGES.MANAGED_CONSENT_BTN_DOWNLOAD
    });
    dl.addEventListener("click", () => this.resolveAndClose({ kind: MANAGED_CONSENT_RESULT.DOWNLOAD }));
  }
};
function safeAssetName(variant) {
  try {
    return assetNameForVariant(variant);
  } catch {
    return "lilbee";
  }
}
function formatMb(bytes) {
  if (!bytes || bytes < 0) return "?";
  return `~${Math.round(bytes / 1024 / 1024)} MB`;
}

// src/views/chat-view.ts
var import_obsidian20 = require("obsidian");

// src/views/source-preview-modal.ts
var import_obsidian16 = require("obsidian");

// src/utils/code-preview.ts
var EXTENSION_LANGUAGE = {
  py: "python",
  pyi: "python",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  scala: "scala",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  json: "json",
  jsonc: "json",
  xml: "xml",
  sql: "sql",
  lua: "lua",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  hs: "haskell"
};
var FILENAME_LANGUAGE = {
  dockerfile: "docker",
  makefile: "makefile"
};
function languageForSource(source) {
  const name = source.replace(/^.*[\\/]/, "").toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return FILENAME_LANGUAGE[name] ?? null;
  }
  return EXTENSION_LANGUAGE[name.slice(dot + 1)] ?? null;
}
function citedLineScrollTop(scrollHeight, totalLines, line) {
  if (line === null || line <= 1 || totalLines <= 0 || scrollHeight <= 0) return 0;
  const lineHeight = scrollHeight / totalLines;
  return Math.max(0, (line - 1) * lineHeight - lineHeight * 2);
}
function toCodeFence(content, lang) {
  const longestRun = (content.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${lang}
${content}
${fence}`;
}

// src/views/source-preview-modal.ts
var TEXT_INLINE_RENDER_DENY = /* @__PURE__ */ new Set([
  "text/html",
  "text/javascript",
  "application/javascript",
  "application/xhtml+xml",
  "text/css"
]);
var SourcePreviewModal = class extends import_obsidian16.Modal {
  api;
  source;
  renderComponent;
  /** Live blob URL backing the embedded PDF; revoked when the modal closes. */
  pdfObjectUrl = null;
  closed = false;
  constructor(app, api, source) {
    super(app);
    this.api = api;
    this.source = source;
    this.renderComponent = new import_obsidian16.Component();
    bindEscapeToClose(this);
  }
  onOpen() {
    this.renderComponent.load();
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-modal");
    contentEl.addClass("lilbee-preview-modal");
    modalEl.addClass("lilbee-preview-modal-frame");
    contentEl.createEl("h2", { text: MESSAGES.TITLE_SOURCE_PREVIEW });
    this.makeDraggable(contentEl);
    this.renderHeader(contentEl);
    if (!this.source.source) {
      new import_obsidian16.Notice(MESSAGES.ERROR_PREVIEW_INVALID_SOURCE);
      contentEl.createEl("p", { text: MESSAGES.ERROR_PREVIEW_INVALID_SOURCE, cls: "lilbee-preview-error" });
      this.renderFooter(contentEl);
      return;
    }
    const bodyHost = contentEl.createDiv({ cls: "lilbee-preview-host" });
    bodyHost.createDiv({ cls: "lilbee-preview-loading" });
    this.renderFooter(contentEl);
    void this.loadContent(bodyHost);
  }
  onClose() {
    this.closed = true;
    this.releasePdfObjectUrl();
    this.renderComponent.unload();
    this.contentEl.empty();
    if (this.dragMoveHandler) {
      window.removeEventListener("pointermove", this.dragMoveHandler);
      this.dragMoveHandler = null;
    }
    if (this.dragUpHandler) {
      window.removeEventListener("pointerup", this.dragUpHandler);
      this.dragUpHandler = null;
    }
  }
  dragMoveHandler = null;
  dragUpHandler = null;
  // Promotes Obsidian's auto-centered modal to explicit top/left on the
  // first drag so the modal stays where the user puts it across resize.
  // The whole chrome (title, header, footer, padding) is the drag surface,
  // but pointer events that land inside the embedded body or on an
  // interactive element (button/input/link) pass through.
  makeDraggable(handle) {
    handle.addClass("lilbee-preview-drag-handle");
    handle.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      const target2 = down.target;
      if (target2?.closest(".lilbee-preview-host, button, input, textarea, select, a")) return;
      down.preventDefault();
      const rect = this.modalEl.getBoundingClientRect();
      const offsetX = down.clientX - rect.left;
      const offsetY = down.clientY - rect.top;
      this.modalEl.setCssProps({ margin: "0", left: `${rect.left}px`, top: `${rect.top}px` });
      const move = (e) => {
        this.modalEl.setCssProps({ left: `${e.clientX - offsetX}px`, top: `${e.clientY - offsetY}px` });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.dragMoveHandler = null;
        this.dragUpHandler = null;
      };
      this.dragMoveHandler = move;
      this.dragUpHandler = up;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }
  renderHeader(container) {
    const header = container.createDiv({ cls: "lilbee-preview-header" });
    header.createSpan({
      text: this.source.vault_path ?? this.source.source,
      cls: "lilbee-preview-path"
    });
    const loc = formatLocation(this.source);
    if (loc) {
      container.createSpan({ text: loc, cls: "lilbee-preview-meta" });
    }
  }
  renderFooter(container) {
    const footer = container.createDiv({ cls: "lilbee-preview-footer" });
    const inVaultPath = this.resolveVaultPath();
    if (inVaultPath !== null) {
      const openBtn = footer.createEl("button", {
        text: MESSAGES.LABEL_PREVIEW_OPEN_IN_VAULT,
        cls: "lilbee-preview-open-vault"
      });
      openBtn.addEventListener("click", () => {
        void this.app.workspace.openLinkText(inVaultPath, "");
        this.close();
      });
    } else {
      const save = footer.createEl("button", {
        text: MESSAGES.LABEL_PREVIEW_SAVE_TO_VAULT,
        cls: "lilbee-preview-save"
      });
      save.disabled = true;
      save.setAttribute("title", MESSAGES.TOOLTIP_PREVIEW_SAVE_SOON);
    }
    const close = footer.createEl("button", {
      text: MESSAGES.LABEL_PREVIEW_CLOSE,
      cls: "lilbee-preview-close mod-cta"
    });
    close.addEventListener("click", () => this.close());
  }
  resolveVaultPath() {
    const vault = this.app.vault;
    const vaultPath = this.source.vault_path;
    if (vaultPath && vault.getAbstractFileByPath(vaultPath)) {
      return vaultPath;
    }
    if (this.source.source && vault.getAbstractFileByPath(this.source.source)) {
      return this.source.source;
    }
    return null;
  }
  async loadContent(host) {
    try {
      const content = await this.api.getSource(this.source.source);
      host.empty();
      this.renderBody(host, content);
    } catch (err3) {
      this.showLoadError(host, err3);
    }
  }
  showLoadError(host, err3) {
    const message = MESSAGES.ERROR_PREVIEW_LOAD(errorMessage(err3, String(err3)));
    host.empty();
    host.createEl("p", { text: message, cls: "lilbee-preview-error" });
    new import_obsidian16.Notice(message);
  }
  renderBody(host, content) {
    const ct = content.content_type;
    const isPdf = isPdfContentType(this.source.content_type) || isPdfContentType(ct);
    if (isPdf) {
      void this.renderPdf(host);
      return;
    }
    const textBlocked = TEXT_INLINE_RENDER_DENY.has(ct);
    if (!textBlocked && ct.startsWith("text/")) {
      const body = host.createDiv({ cls: "lilbee-preview-body" });
      const lang = languageForSource(this.source.source);
      const markdown = lang === null ? content.markdown : toCodeFence(content.markdown, lang);
      void import_obsidian16.MarkdownRenderer.render(this.app, markdown, body, "", this.renderComponent).then(() => {
        if (lang !== null) this.scrollToCitedLine(host, body, content.markdown);
      });
      return;
    }
    host.createEl("p", {
      text: MESSAGES.ERROR_PREVIEW_UNSUPPORTED(ct),
      cls: "lilbee-preview-error"
    });
  }
  /** Scroll the rendered code so the cited chunk's first line is in view. */
  scrollToCitedLine(host, body, code) {
    host.scrollTop = citedLineScrollTop(body.scrollHeight, code.split("\n").length, this.source.line_start);
  }
  /** Fetch the PDF bytes through the authenticated client into a blob URL. */
  async renderPdf(host) {
    let url;
    try {
      const res = await this.api.getSourceRaw(this.source.source);
      url = URL.createObjectURL(await res.blob());
    } catch (err3) {
      this.showLoadError(host, err3);
      return;
    }
    if (this.closed) {
      URL.revokeObjectURL(url);
      return;
    }
    this.pdfObjectUrl = url;
    const body = host.createDiv({ cls: "lilbee-preview-body" });
    const frame = body.createEl("object", { cls: "lilbee-preview-pdf-frame" });
    frame.setAttribute("type", CONTENT_TYPE.PDF);
    const page = this.source.page_start;
    frame.setAttribute("data", page && page > 0 ? `${url}#page=${page}` : url);
  }
  releasePdfObjectUrl() {
    if (this.pdfObjectUrl === null) return;
    URL.revokeObjectURL(this.pdfObjectUrl);
    this.pdfObjectUrl = null;
  }
};

// src/utils/source-click.ts
var SOURCE_ACTION = {
  VAULT_MARKDOWN: "vault-markdown",
  VAULT_NOTE: "vault-note",
  PREVIEW: "preview"
};
function isMarkdownish(contentType) {
  return contentType === CONTENT_TYPE.MARKDOWN || contentType === CONTENT_TYPE.HTML;
}
function vaultAction(source, path) {
  if (isMarkdownish(source.content_type) && source.line_start !== null) {
    return {
      kind: SOURCE_ACTION.VAULT_MARKDOWN,
      path,
      line: source.line_start
    };
  }
  return { kind: SOURCE_ACTION.VAULT_NOTE, path };
}
function sourceClickAction(source, vault) {
  if (isPdfContentType(source.content_type)) {
    return { kind: SOURCE_ACTION.PREVIEW, source };
  }
  const vaultPath = source.vault_path;
  if (vaultPath && vault.getAbstractFileByPath(vaultPath)) {
    return vaultAction(source, vaultPath);
  }
  if (source.source && vault.getAbstractFileByPath(source.source)) {
    return vaultAction(source, source.source);
  }
  return { kind: SOURCE_ACTION.PREVIEW, source };
}
async function executeSourceClick(app, api, action) {
  switch (action.kind) {
    case SOURCE_ACTION.VAULT_MARKDOWN:
      void app.workspace.openLinkText(action.path, "", false, { eState: { line: action.line } });
      return;
    case SOURCE_ACTION.VAULT_NOTE:
      void app.workspace.openLinkText(action.path, "");
      return;
    case SOURCE_ACTION.PREVIEW:
      new SourcePreviewModal(app, api, action.source).open();
      return;
  }
}

// src/views/results.ts
var MAX_EXCERPT_CHARS = 200;
var MAX_EXCERPTS = 3;
function documentResultToSource(result) {
  const excerpt = result.excerpts[0];
  return {
    source: result.source,
    content_type: result.content_type,
    distance: 0,
    chunk: excerpt?.content ?? "",
    page_start: excerpt?.page_start ?? null,
    page_end: excerpt?.page_end ?? null,
    line_start: excerpt?.line_start ?? null,
    line_end: excerpt?.line_end ?? null
  };
}
function formatLocation(excerpt) {
  const pageStart = excerpt.page_start ?? 0;
  if (pageStart > 0) {
    const pageEnd = excerpt.page_end ?? 0;
    return pageEnd > 0 && pageEnd !== pageStart ? `pp. ${pageStart}\u2013${pageEnd}` : `p. ${pageStart}`;
  }
  const lineStart = excerpt.line_start ?? 0;
  if (lineStart > 0) {
    const lineEnd = excerpt.line_end ?? 0;
    return lineEnd > 0 && lineEnd !== lineStart ? `lines ${lineStart}\u2013${lineEnd}` : `line ${lineStart}`;
  }
  return null;
}
function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
function renderDocumentResult(container, result, app, api) {
  const card = container.createDiv({ cls: "lilbee-document-card" });
  const header = card.createDiv({ cls: "lilbee-document-card-header" });
  const link = header.createEl("a", {
    text: result.source,
    cls: "lilbee-document-source"
  });
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const source = documentResultToSource(result);
    void executeSourceClick(app, api, sourceClickAction(source, app.vault));
  });
  header.createSpan({
    text: result.content_type,
    cls: "lilbee-content-badge"
  });
  const barContainer = card.createDiv({ cls: "lilbee-relevance-bar-container" });
  const bar = barContainer.createDiv({ cls: "lilbee-relevance-bar" });
  const pct = Math.round(Math.max(0, Math.min(1, result.best_relevance)) * 100);
  bar.style.width = `${pct}%`;
  const excerpts = result.excerpts.slice(0, MAX_EXCERPTS);
  for (const excerpt of excerpts) {
    const excerptEl = card.createDiv({ cls: "lilbee-excerpt" });
    excerptEl.createEl("p", { text: truncate(excerpt.content, MAX_EXCERPT_CHARS) });
    const loc = formatLocation(excerpt);
    if (loc) {
      excerptEl.createSpan({ text: loc, cls: "lilbee-location" });
    }
  }
}
function renderSourceChip(container, source, app, api, onWikiClick) {
  const isWiki = source.chunk_type === SEARCH_CHUNK_TYPE.WIKI;
  const cls = isWiki ? "lilbee-source-chip lilbee-source-chip-wiki" : "lilbee-source-chip";
  const chip = container.createSpan({ cls });
  if (source.claim_type === CLAIM_TYPE.FACT) {
    chip.addClass("lilbee-claim-fact");
  } else if (source.claim_type === CLAIM_TYPE.INFERENCE) {
    chip.addClass("lilbee-claim-inference");
  }
  let label = source.source;
  const loc = formatLocation(source);
  if (loc) {
    label += ` (${loc})`;
  }
  if (isWiki) {
    chip.createSpan({ text: "W", cls: "lilbee-wiki-type-badge" });
    chip.createSpan({ text: label });
  } else {
    chip.setText(label);
  }
  chip.addClass("lilbee-clickable");
  if (isWiki && onWikiClick) {
    chip.addEventListener("click", () => onWikiClick(source.source));
  } else {
    chip.addEventListener("click", () => {
      void executeSourceClick(app, api, sourceClickAction(source, app.vault));
    });
  }
}
function renderAggregatedSourceChips(container, sources, app, api) {
  const groups = groupSourcesByFile(sources);
  for (const group of groups) {
    const first = group[0];
    if (first.chunk_type === SEARCH_CHUNK_TYPE.WIKI) {
      for (const s of group) renderSourceChip(container, s, app, api);
      continue;
    }
    const chip = container.createSpan({ cls: "lilbee-source-chip lilbee-source-chip-grouped" });
    chip.createSpan({ text: first.source, cls: "lilbee-source-chip-file" });
    for (const source of group) {
      const loc = formatLocation(source);
      const label = loc ?? "open";
      const tag = chip.createSpan({ text: label, cls: "lilbee-source-chip-loc" });
      tag.addClass("lilbee-clickable");
      tag.addEventListener("click", (e) => {
        e.stopPropagation();
        void executeSourceClick(app, api, sourceClickAction(source, app.vault));
      });
    }
  }
}
function groupSourcesByFile(sources) {
  const order = [];
  const buckets = /* @__PURE__ */ new Map();
  for (const source of sources) {
    const key = `${source.chunk_type ?? SEARCH_CHUNK_TYPE.RAW}::${source.source}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key).push(source);
  }
  return order.map((k) => buckets.get(k));
}

// src/views/crawl-modal.ts
var import_obsidian17 = require("obsidian");
function parseOptionalCount(raw, opts) {
  const errMsg = opts.allowZero ? MESSAGES.ERROR_CRAWL_DEPTH_INVALID : MESSAGES.ERROR_CRAWL_MAX_PAGES_POSITIVE;
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, error: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { value: null, error: errMsg };
  }
  if (n === 0 && !opts.allowZero) {
    return { value: null, error: errMsg };
  }
  return { value: n, error: null };
}
var asInput2 = (el) => el;
var CrawlModal = class extends import_obsidian17.Modal {
  plugin;
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-crawl-modal");
    contentEl.createEl("h2", { text: MESSAGES.TITLE_CRAWL_WEB_PAGE });
    const urlInput = contentEl.createEl("input", {
      cls: "lilbee-crawl-url",
      placeholder: MESSAGES.PLACEHOLDER_URL,
      attr: { type: "text", title: MESSAGES.TOOLTIP_CRAWL_URL }
    });
    const recursiveRow = contentEl.createDiv({ cls: "lilbee-crawl-recursive-row" });
    const recursiveLabel = recursiveRow.createEl("label", {
      cls: "lilbee-crawl-recursive",
      attr: { title: MESSAGES.TOOLTIP_CRAWL_RECURSIVE }
    });
    const recursiveInput = recursiveLabel.createEl("input", {
      cls: "lilbee-crawl-recursive-input",
      attr: { type: "checkbox" }
    });
    asInput2(recursiveInput).checked = false;
    recursiveLabel.createSpan({ text: MESSAGES.LABEL_CRAWL_RECURSIVE });
    const infoBtn = recursiveRow.createEl("button", {
      cls: "lilbee-crawl-info-btn",
      attr: {
        type: "button",
        "aria-label": MESSAGES.LABEL_CRAWL_RECURSIVE_INFO,
        "aria-expanded": "false"
      }
    });
    (0, import_obsidian17.setIcon)(infoBtn, "info");
    const notice = contentEl.createDiv({ cls: "lilbee-crawl-notice" });
    notice.setAttribute("hidden", "hidden");
    notice.setText(MESSAGES.NOTICE_CRAWL_RECURSIVE);
    let noticeOpen = false;
    const setNoticeOpen = (open) => {
      noticeOpen = open;
      if (open) {
        notice.removeAttribute("hidden");
        infoBtn.setAttribute("aria-expanded", "true");
      } else {
        notice.setAttribute("hidden", "hidden");
        infoBtn.setAttribute("aria-expanded", "false");
      }
    };
    infoBtn.addEventListener("click", () => setNoticeOpen(!noticeOpen));
    const browserRow = contentEl.createDiv({ cls: "lilbee-crawl-browser-row" });
    const browserLabel = browserRow.createEl("label", {
      cls: "lilbee-crawl-browser",
      attr: { title: MESSAGES.TOOLTIP_CRAWL_USE_BROWSER }
    });
    const browserInput = browserLabel.createEl("input", {
      cls: "lilbee-crawl-browser-input",
      attr: { type: "checkbox" }
    });
    asInput2(browserInput).checked = false;
    browserLabel.createSpan({ text: MESSAGES.LABEL_CRAWL_USE_BROWSER });
    void this.plugin.api.config().then((cfg) => {
      asInput2(browserInput).checked = cfg.crawl_render_mode === CRAWL_RENDER_MODE.BROWSER;
    }).catch(() => {
    });
    const advanced = contentEl.createEl("details", { cls: "lilbee-crawl-advanced" });
    advanced.createEl("summary", { text: MESSAGES.LABEL_CRAWL_ADVANCED });
    const subdomainsRow = advanced.createDiv({ cls: "lilbee-crawl-subdomains-row" });
    const subdomainsLabel = subdomainsRow.createEl("label", {
      cls: "lilbee-crawl-subdomains",
      attr: { title: MESSAGES.TOOLTIP_CRAWL_SUBDOMAINS }
    });
    const subdomainsInput = subdomainsLabel.createEl("input", {
      cls: "lilbee-crawl-subdomains-input",
      attr: { type: "checkbox" }
    });
    asInput2(subdomainsInput).checked = false;
    subdomainsLabel.createSpan({ text: MESSAGES.LABEL_CRAWL_SUBDOMAINS });
    const options = advanced.createDiv({ cls: "lilbee-crawl-options" });
    const depthLabel = options.createEl("label", { text: MESSAGES.LABEL_DEPTH });
    const depthInput = depthLabel.createEl("input", {
      cls: "lilbee-crawl-depth",
      placeholder: MESSAGES.HINT_CRAWL_BLANK_NO_LIMIT,
      attr: { type: "number", min: "0", title: MESSAGES.TOOLTIP_CRAWL_DEPTH }
    });
    asInput2(depthInput).value = "";
    const maxLabel = options.createEl("label", { text: MESSAGES.LABEL_MAX_PAGES });
    const maxInput = maxLabel.createEl("input", {
      cls: "lilbee-crawl-max-pages",
      placeholder: MESSAGES.HINT_CRAWL_BLANK_NO_LIMIT,
      attr: { type: "number", min: "1", title: MESSAGES.TOOLTIP_CRAWL_MAX_PAGES }
    });
    asInput2(maxInput).value = "";
    const errorEl = contentEl.createDiv({ cls: "lilbee-crawl-error" });
    const syncRecursiveState = () => {
      const recursive = asInput2(recursiveInput).checked;
      asInput2(depthInput).disabled = !recursive;
      asInput2(maxInput).disabled = !recursive;
      advanced.style.display = recursive ? "" : "none";
      infoBtn.style.display = recursive ? "" : "none";
      if (!recursive) {
        errorEl.setText("");
        setNoticeOpen(false);
      }
    };
    recursiveInput.addEventListener("change", syncRecursiveState);
    syncRecursiveState();
    const actions = contentEl.createDiv({ cls: "lilbee-crawl-actions" });
    const crawlBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CRAWL, cls: "mod-cta" });
    crawlBtn.addEventListener("click", () => {
      const raw = asInput2(urlInput).value.trim();
      if (!raw) {
        new import_obsidian17.Notice(MESSAGES.NOTICE_ENTER_URL);
        return;
      }
      const url = ensureUrlScheme(raw);
      const recursive = asInput2(recursiveInput).checked;
      let depth;
      let maxPages;
      if (!recursive) {
        depth = 0;
        maxPages = null;
        errorEl.setText("");
      } else {
        const depthRes = parseOptionalCount(asInput2(depthInput).value, { allowZero: true });
        const maxRes = parseOptionalCount(asInput2(maxInput).value, { allowZero: false });
        const err3 = maxRes.error ?? depthRes.error;
        if (err3) {
          errorEl.setText(err3);
          advanced.open = true;
          return;
        }
        errorEl.setText("");
        depth = depthRes.value;
        maxPages = maxRes.value;
      }
      const renderMode = asInput2(browserInput).checked ? CRAWL_RENDER_MODE.BROWSER : CRAWL_RENDER_MODE.HTTP;
      void this.plugin.api.updateConfig({ [CONFIG_KEY.CRAWL_RENDER_MODE]: renderMode }).catch(() => {
      });
      const includeSubdomains = recursive ? asInput2(subdomainsInput).checked : void 0;
      void this.plugin.runCrawl(url, depth, maxPages, renderMode, includeSubdomains);
      this.close();
    });
    const cancelBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CANCEL });
    cancelBtn.addEventListener("click", () => this.close());
  }
};

// src/views/sessions-modal.ts
var import_obsidian18 = require("obsidian");
var SessionsModal = class extends import_obsidian18.Modal {
  plugin;
  hooks;
  sessions = [];
  filter = "";
  renamingId = null;
  loadFailed = false;
  /** True when the server said sessions are switched off; renders the turn-on offer. */
  disabled = false;
  listEl = null;
  countEl = null;
  constructor(app, plugin, hooks) {
    super(app);
    this.plugin = plugin;
    this.hooks = hooks;
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-sessions-modal");
    const header = contentEl.createDiv({ cls: "lilbee-sessions-header" });
    header.createEl("h2", { text: MESSAGES.TITLE_SESSIONS });
    this.countEl = header.createSpan({ cls: "lilbee-sessions-count" });
    const newBtn = header.createEl("button", { cls: "lilbee-sessions-new" });
    (0, import_obsidian18.setIcon)(newBtn, "plus");
    newBtn.setAttribute("aria-label", MESSAGES.LABEL_NEW_SESSION);
    newBtn.addEventListener("click", () => {
      this.hooks.startNew();
      this.close();
    });
    const filterEl = contentEl.createEl("input", {
      cls: "lilbee-sessions-filter",
      placeholder: MESSAGES.PLACEHOLDER_FILTER_SESSIONS,
      attr: { type: "text" }
    });
    filterEl.addEventListener("input", () => {
      this.filter = filterEl.value;
      this.renderList();
    });
    window.setTimeout(() => filterEl.focus(), 0);
    this.listEl = contentEl.createDiv({ cls: "lilbee-sessions-list" });
    void this.load();
  }
  async load() {
    try {
      this.sessions = await this.plugin.api.listSessions();
      this.loadFailed = false;
      this.disabled = false;
    } catch (err3) {
      this.loadFailed = true;
      if (err3 instanceof Error && isHttpStatus(err3, 404)) {
        this.disabled = true;
      } else {
        const reason = errorMessage(err3, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
        new import_obsidian18.Notice(MESSAGES.ERROR_SESSIONS_LOAD_FAILED(reason));
      }
    }
    this.renderList();
  }
  /** Flip the server's writable `sessions_enabled` flag, then reload the list. */
  async enableSessions() {
    try {
      await this.plugin.api.updateConfig({ sessions_enabled: true });
    } catch (err3) {
      const reason = errorMessage(err3, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
      new import_obsidian18.Notice(MESSAGES.ERROR_SESSIONS_ENABLE_FAILED(reason));
      return;
    }
    await this.load();
  }
  renderDisabledState(container) {
    const box = container.createDiv({ cls: "lilbee-sessions-disabled" });
    box.createDiv({ cls: "lilbee-sessions-disabled-text", text: MESSAGES.SESSIONS_DISABLED });
    const enableBtn = box.createEl("button", {
      cls: "lilbee-sessions-enable",
      text: MESSAGES.LABEL_ENABLE_SESSIONS
    });
    enableBtn.addEventListener("click", () => void this.enableSessions());
  }
  /** Case-insensitive substring on the title, matching the TUI's filter. */
  visible() {
    const needle = this.filter.trim().toLowerCase();
    if (!needle) return this.sessions;
    return this.sessions.filter((s) => s.title.toLowerCase().includes(needle));
  }
  renderList() {
    if (!this.listEl) return;
    this.listEl.empty();
    const rows = this.visible();
    this.countEl?.setText(MESSAGES.SESSIONS_COUNT(rows.length));
    if (rows.length === 0) {
      if (this.disabled) {
        this.renderDisabledState(this.listEl);
        return;
      }
      if (this.loadFailed) return;
      const empty = this.sessions.length === 0 ? MESSAGES.SESSIONS_EMPTY : MESSAGES.SESSIONS_NO_MATCH;
      this.listEl.createDiv({ cls: "lilbee-sessions-empty", text: empty });
      return;
    }
    for (const meta of rows) this.renderRow(this.listEl, meta);
  }
  renderRow(container, meta) {
    const isActive = meta.id === this.hooks.activeId;
    const row = container.createDiv({
      cls: `lilbee-session-row${isActive ? " is-active" : ""}`
    });
    if (this.renamingId === meta.id) {
      this.renderRenameField(row, meta);
      return;
    }
    const main = row.createDiv({ cls: "lilbee-session-main" });
    const titleRow = main.createDiv({ cls: "lilbee-session-title-row" });
    titleRow.createSpan({ cls: "lilbee-session-title", text: meta.title });
    const dateEl = titleRow.createSpan({
      cls: "lilbee-session-date",
      text: relativeTimeFromIso(meta.updated_at)
    });
    if (meta.updated_at) dateEl.setAttribute("title", meta.updated_at);
    main.createDiv({
      cls: "lilbee-session-meta",
      text: MESSAGES.SESSIONS_ROW_META(meta.message_count, displayLabelForRef(meta.model_ref))
    });
    main.addEventListener("click", () => this.resume(meta));
    const actions = row.createDiv({ cls: "lilbee-session-actions" });
    const renameBtn = actions.createEl("button", { cls: "lilbee-session-rename" });
    (0, import_obsidian18.setIcon)(renameBtn, "pencil");
    renameBtn.setAttribute("aria-label", MESSAGES.LABEL_RENAME_SESSION);
    renameBtn.addEventListener("click", () => {
      this.renamingId = meta.id;
      this.renderList();
    });
    const deleteBtn = actions.createEl("button", { cls: "lilbee-session-delete" });
    (0, import_obsidian18.setIcon)(deleteBtn, "trash-2");
    deleteBtn.setAttribute("aria-label", MESSAGES.LABEL_DELETE_SESSION);
    deleteBtn.addEventListener("click", () => void this.confirmDelete(meta));
  }
  renderRenameField(row, meta) {
    const input = row.createEl("input", {
      cls: "lilbee-session-rename-input",
      placeholder: MESSAGES.PLACEHOLDER_RENAME_SESSION,
      attr: { type: "text" }
    });
    input.value = meta.title;
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") void this.commitRename(meta, input.value);
      else if (evt.key === "Escape") {
        evt.stopPropagation();
        this.renamingId = null;
        this.renderList();
      }
    });
  }
  /** An empty title is discarded rather than written, matching the TUI. */
  async commitRename(meta, raw) {
    const title = raw.trim();
    this.renamingId = null;
    if (!title || title === meta.title) {
      this.renderList();
      return;
    }
    try {
      await this.plugin.api.renameSession(meta.id, title);
      meta.title = title;
    } catch (err3) {
      const reason = errorMessage(err3, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
      new import_obsidian18.Notice(MESSAGES.ERROR_SESSION_RENAME_FAILED(reason));
    }
    this.renderList();
  }
  async confirmDelete(meta) {
    const modal = new ConfirmModal(this.app, MESSAGES.NOTICE_CONFIRM_DELETE_SESSION(meta.title));
    modal.open();
    if (!await modal.result) return;
    try {
      await this.plugin.api.deleteSession(meta.id);
      this.sessions = this.sessions.filter((s) => s.id !== meta.id);
      new import_obsidian18.Notice(MESSAGES.NOTICE_SESSION_DELETED(meta.title));
      this.renderList();
    } catch (err3) {
      const reason = errorMessage(err3, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
      new import_obsidian18.Notice(MESSAGES.ERROR_SESSION_DELETE_FAILED(reason));
    }
  }
  resume(meta) {
    this.hooks.resume(meta.id);
    this.close();
  }
};

// src/utils/session.ts
var SESSION_SCOPE = {
  RAW: "raw",
  WIKI: "wiki",
  BOTH: "both"
};
var SESSION_TITLE_MAX_LEN = 60;
var TITLE_ELLIPSIS = "\u2026";
function scopeFromChunkType(chunk) {
  return chunk === SEARCH_CHUNK_TYPE.ALL ? SESSION_SCOPE.BOTH : chunk;
}
function chunkTypeFromScope(scope) {
  switch (scope) {
    case SESSION_SCOPE.BOTH:
      return SEARCH_CHUNK_TYPE.ALL;
    case SESSION_SCOPE.WIKI:
      return SEARCH_CHUNK_TYPE.WIKI;
    case SESSION_SCOPE.RAW:
      return SEARCH_CHUNK_TYPE.RAW;
    default:
      return null;
  }
}
function deriveSessionTitle(text) {
  const stripped = text.trim();
  if (!stripped) return MESSAGES.SESSIONS_UNTITLED;
  const first = stripped.split(/\r\n|[\r\n]/)[0];
  if (first.length > SESSION_TITLE_MAX_LEN) return first.slice(0, SESSION_TITLE_MAX_LEN) + TITLE_ELLIPSIS;
  return first;
}

// src/views/placement-view.ts
var import_obsidian19 = require("obsidian");
var VIEW_TYPE_PLACEMENT = "lilbee-placement";
async function revealPlacementBeside(app, sourceLeaf) {
  const existing = app.workspace.getLeavesOfType(VIEW_TYPE_PLACEMENT);
  if (existing.length > 0) {
    await app.workspace.revealLeaf(existing[0]);
    return;
  }
  const leaf = app.workspace.createLeafBySplit(sourceLeaf, "vertical");
  await leaf.setViewState({ type: VIEW_TYPE_PLACEMENT, active: false });
  await app.workspace.revealLeaf(leaf);
}
var PREVIEW_DEBOUNCE_MS = 350;
var STARTUP_RETRY_MS = 2e3;
var HTTP_NOT_FOUND = 404;
var HTTP_CONFLICT = 409;
var HTTP_UNPROCESSABLE = 422;
var GB = 1e9;
function formatGb(bytes) {
  return `${(bytes / GB).toFixed(1)} GB`;
}
var UNIFIED_BACKENDS = /* @__PURE__ */ new Set(["mtl", "metal"]);
function isUnifiedMemory(gpu) {
  return UNIFIED_BACKENDS.has(gpu.backend.toLowerCase()) && gpu.name.startsWith("Apple");
}
var PlacementView = class extends import_obsidian19.ItemView {
  plugin;
  current = null;
  mode = PLACEMENT_MODE.AUTO;
  draft = /* @__PURE__ */ new Map();
  applying = false;
  unplaceable = [];
  applyDisabled = false;
  multiDevice = false;
  previewTimer = null;
  startupRetryTimer = null;
  waitingForServer = false;
  statsController = null;
  gpuNotice = null;
  gpuNoticeEl = null;
  /** Live util + vram bars and their text per device index, updated in place by the stats stream. */
  // vramFill/memText are absent on unified-memory rows, which render a static capacity label.
  gpuBars = /* @__PURE__ */ new Map();
  bodyEl = null;
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_PLACEMENT;
  }
  getDisplayText() {
    return MESSAGES.LABEL_PLACEMENT_VIEW;
  }
  getIcon() {
    return "cpu";
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-placement-container");
    this.bodyEl = contentEl.createDiv({ cls: "lilbee-placement-body" });
    await this.reload();
    void this.subscribeStats();
  }
  async reload() {
    const result = await this.plugin.api.placement();
    if (result.isErr()) {
      this.current = null;
      if (this.isTransientStartupError(result.error)) {
        this.waitingForServer = true;
        this.renderWaitingForServer();
        this.scheduleStartupRetry();
        return;
      }
      this.waitingForServer = false;
      if (isHttpStatus(result.error, HTTP_NOT_FOUND)) {
        this.renderMessage(MESSAGES.PLACEMENT_NEEDS_NEWER_SERVER);
        return;
      }
      this.renderMessage(
        MESSAGES.PLACEMENT_LOAD_FAILED(
          errorMessage(result.error, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode)
        )
      );
      return;
    }
    const resumedAfterWait = this.waitingForServer;
    this.waitingForServer = false;
    this.adoptResponse(result.value);
    if (resumedAfterWait) void this.subscribeStats();
  }
  /** Whether a failed load will heal on its own if we keep polling.
   *  A 401 in managed mode is the startup race between a restored leaf and
   *  session-token discovery: the plugin holds the previous run's token until
   *  it reads the fresh server.json. External mode's token is user-entered,
   *  so a rejection there is actionable, not transient. */
  isTransientStartupError(error) {
    if (error.name === ERROR_NAME.SERVER_STARTING) return true;
    return error.name === ERROR_NAME.SESSION_TOKEN && this.plugin.settings.serverMode === SERVER_MODE.MANAGED;
  }
  /** Live holding state while the server boots; reload() polls until it answers. */
  renderWaitingForServer() {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    const wait = this.bodyEl.createDiv({ cls: "lilbee-placement-empty lilbee-placement-waiting" });
    wait.createDiv({ cls: "lilbee-placement-spinner" });
    wait.createDiv({ text: MESSAGES.PLACEMENT_WAITING_SERVER });
  }
  scheduleStartupRetry() {
    if (this.startupRetryTimer !== null) window.clearTimeout(this.startupRetryTimer);
    this.startupRetryTimer = window.setTimeout(() => {
      this.startupRetryTimer = null;
      void this.reload();
    }, STARTUP_RETRY_MS);
  }
  /** Rebuild the editable draft from the current resolved plan. */
  seedDraft(roles) {
    this.draft = /* @__PURE__ */ new Map();
    for (const role of roles) {
      this.draft.set(role.role, { devices: new Set(role.devices), replicas: role.replicas });
    }
  }
  /** The draft for a role, created (pinned to no device, single replica) if absent. */
  draftFor(role) {
    let d = this.draft.get(role);
    if (!d) {
      d = { devices: /* @__PURE__ */ new Set(), replicas: 1 };
      this.draft.set(role, d);
    }
    return d;
  }
  renderMessage(message) {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    this.bodyEl.createDiv({ cls: "lilbee-placement-empty", text: message });
  }
  render() {
    const data = this.current;
    if (!this.bodyEl || !data) return;
    this.multiDevice = data.gpus.length >= 2;
    this.gpuBars.clear();
    this.gpuNoticeEl = null;
    this.bodyEl.empty();
    this.renderHeader(this.bodyEl, data);
    this.renderNotice(this.bodyEl, data.notice ?? null);
    if (data.gpus.length < 2) {
      this.renderSingleDevice(this.bodyEl, data);
    } else {
      this.renderMatrix(this.bodyEl, data);
    }
    this.renderFooter(this.bodyEl, data);
    if (this.applying) this.renderApplyingOverlay(this.bodyEl);
  }
  stateLabel(data) {
    if (this.applying) return MESSAGES.PLACEMENT_STATE_APPLYING;
    if (this.mode === PLACEMENT_MODE.MANUAL) {
      return this.isEdited(data) ? MESSAGES.PLACEMENT_STATE_EDITED : MESSAGES.PLACEMENT_STATE_MANUAL;
    }
    return MESSAGES.PLACEMENT_STATE_AUTO;
  }
  renderHeader(container, data) {
    const header = container.createDiv({ cls: "lilbee-placement-header" });
    header.createEl("h2", { text: MESSAGES.PLACEMENT_TITLE });
    const state = this.applying ? "applying" : this.mode;
    header.createSpan({ cls: `lilbee-placement-state is-${state}`, text: this.stateLabel(data) });
  }
  /** Server-issued host fix hint, rendered verbatim under a localized label. */
  renderNotice(container, notice) {
    this.gpuNotice = notice;
    this.gpuNoticeEl = notice ? this.createNoticeEl(container, notice) : null;
  }
  createNoticeEl(container, notice) {
    const el = container.createDiv({ cls: "lilbee-placement-notice", text: MESSAGES.PLACEMENT_GPU_NOTICE(notice) });
    this.tip(el, MESSAGES.PLACEMENT_GPU_NOTICE_TOOLTIP);
    return el;
  }
  renderSectionTitle(container, text) {
    container.createDiv({ cls: "lilbee-placement-section-title", text });
  }
  // ---- hardware cards -------------------------------------------------------
  /** Single device: one unified/CPU host card (no discrete GPUs) or one GPU card. */
  renderSingleDevice(container, data) {
    this.renderSectionTitle(container, MESSAGES.PLACEMENT_SECTION_HARDWARE);
    const hw = container.createDiv({ cls: "lilbee-placement-hw" });
    if (data.gpus.length === 1) {
      this.renderGpuRow(hw, data.gpus[0], data);
    } else {
      this.renderHostCard(hw);
    }
    this.renderRoleSection(container, data, null);
  }
  /** The host's compute when no discrete GPU is enumerated: Apple unified memory
   * (the chat fleet runs on Metal) or a plain CPU host elsewhere. */
  renderHostCard(container) {
    const card = container.createDiv({ cls: "lilbee-placement-card" });
    const head = card.createDiv({ cls: "lilbee-placement-card-head" });
    if (import_obsidian19.Platform.isMacOS) {
      head.createSpan({ cls: "lilbee-placement-card-name", text: MESSAGES.PLACEMENT_HOST_APPLE });
      head.createSpan({ cls: "lilbee-placement-card-sub", text: MESSAGES.PLACEMENT_HOST_APPLE_SUB });
    } else {
      head.createSpan({ cls: "lilbee-placement-card-name", text: MESSAGES.PLACEMENT_HOST_CPU });
      head.createSpan({ cls: "lilbee-placement-card-sub", text: MESSAGES.PLACEMENT_HOST_CPU_SUB });
    }
  }
  /** One GPU as a compact row: index chip, name, role badges, and util + vram
   *  mini-bars. Scales to many GPUs where a card-per-GPU layout would not. */
  renderGpuRow(container, gpu, data) {
    const row = container.createDiv({ cls: "lilbee-gpu-row" });
    row.createSpan({ cls: "lilbee-gpu-idx", text: String(gpu.index) });
    const top = row.createDiv({ cls: "lilbee-gpu-top" });
    top.createSpan({ cls: "lilbee-gpu-name", text: gpu.name });
    const badges = top.createDiv({ cls: "lilbee-gpu-roles" });
    for (const role of data.roles) {
      if (role.devices.includes(gpu.index)) {
        badges.createSpan({ cls: `lilbee-role-badge is-${role.role}`, text: role.role });
      }
    }
    const meters = row.createDiv({ cls: "lilbee-gpu-meters" });
    const util = this.renderMeter(meters, "util", MESSAGES.PLACEMENT_METER_UTIL);
    util.val.setText(MESSAGES.PLACEMENT_UTIL_NA);
    if (isUnifiedMemory(gpu)) {
      const meter = meters.createDiv({ cls: "lilbee-meter lilbee-meter-vram" });
      meter.createSpan({ cls: "lilbee-meter-label", text: MESSAGES.PLACEMENT_METER_VRAM });
      meter.createSpan({
        cls: "lilbee-meter-val",
        text: MESSAGES.PLACEMENT_MEM_UNIFIED(formatGb(gpu.total_bytes))
      });
      this.gpuBars.set(gpu.index, { utilFill: util.fill, utilText: util.val });
      return;
    }
    const vram = this.renderMeter(meters, "vram", MESSAGES.PLACEMENT_METER_VRAM);
    this.setVram(vram, gpu.free_bytes, gpu.total_bytes);
    this.gpuBars.set(gpu.index, {
      utilFill: util.fill,
      utilText: util.val,
      vramFill: vram.fill,
      memText: vram.val
    });
  }
  /** A labelled mini-bar ("util" / "vram"): label, track+fill, value text. */
  renderMeter(container, variant, label) {
    const meter = container.createDiv({ cls: `lilbee-meter lilbee-meter-${variant}` });
    meter.createSpan({ cls: "lilbee-meter-label", text: label });
    const bar = meter.createDiv({ cls: "lilbee-bar" });
    const fill = bar.createDiv({ cls: "lilbee-bar-fill" });
    const val = meter.createSpan({ cls: "lilbee-meter-val" });
    return { fill, val };
  }
  /** Fill the vram bar to the used fraction and set its free/total text. */
  setVram(vram, freeBytes, totalBytes) {
    const usedPct = totalBytes > 0 ? this.clampPct((totalBytes - freeBytes) / totalBytes * 100) : 0;
    vram.fill.setCssProps({ width: `${usedPct}%` });
    vram.val.setText(MESSAGES.PLACEMENT_MEM_FREE(formatGb(freeBytes), formatGb(totalBytes)));
  }
  // ---- roles ----------------------------------------------------------------
  /** The Roles section. `gpus` non-null renders the per-role GPU toggle matrix. */
  renderRoleSection(container, data, gpus) {
    this.renderSectionTitle(container, MESSAGES.PLACEMENT_SECTION_ROLES);
    const table = container.createDiv({ cls: "lilbee-placement-roles" });
    for (const role of data.roles) {
      this.renderRoleRow(table, role, gpus);
    }
  }
  renderRoleRow(container, role, gpus) {
    const row = container.createDiv({ cls: "lilbee-placement-role-row" });
    row.dataset.role = role.role;
    if (this.unplaceable.includes(role.role)) row.addClass("lilbee-placement-role-unfit");
    const head = row.createDiv({ cls: "lilbee-placement-role-head" });
    head.createSpan({ cls: `lilbee-placement-badge is-${role.role}`, text: role.role });
    head.createSpan({ cls: "lilbee-placement-role-hint", text: this.roleHint(role.role) });
    row.createSpan({
      cls: "lilbee-placement-role-model",
      text: role.model ? displayLabelForRef(role.model) : MESSAGES.PLACEMENT_NOT_SET
    });
    if (role.vram_bytes) {
      const vram = row.createSpan({
        cls: "lilbee-placement-role-vram",
        text: MESSAGES.PLACEMENT_ROLE_VRAM(formatGb(role.vram_bytes))
      });
      this.tip(vram, MESSAGES.PLACEMENT_TIP_ROLE_VRAM(role.role));
    }
    if (gpus) {
      const toggles = row.createDiv({ cls: "lilbee-placement-toggles" });
      for (const gpu of gpus) {
        this.renderToggle(toggles, role.role, gpu);
      }
    }
    if (REPLICA_ROLES.has(role.role)) this.renderStepper(row, role.role);
  }
  /** A single-instance role (rerank) pins to exactly one card: it is neither
   *  tensor-split like chat nor data-parallel replicated like embed/vision. */
  isSingleSelect(role) {
    return role !== WORKER_ROLE.CHAT && !REPLICA_ROLES.has(role);
  }
  /** The one-word placement rule shown under each role: split / mirror / one card. */
  roleHint(role) {
    if (role === WORKER_ROLE.CHAT) return MESSAGES.PLACEMENT_HINT_SPLIT;
    if (REPLICA_ROLES.has(role)) return MESSAGES.PLACEMENT_HINT_MIRROR;
    return MESSAGES.PLACEMENT_HINT_SINGLE;
  }
  // ---- multi-GPU matrix -----------------------------------------------------
  renderMatrix(container, data) {
    this.renderSectionTitle(container, MESSAGES.PLACEMENT_SECTION_HARDWARE);
    const hw = container.createDiv({ cls: "lilbee-placement-hw" });
    for (const gpu of data.gpus) {
      this.renderGpuRow(hw, gpu, data);
    }
    this.renderRoleSection(container, data, data.gpus);
  }
  renderToggle(container, role, gpu) {
    const draft = this.draftFor(role);
    let cls = "lilbee-placement-toggle";
    if (this.isSingleSelect(role)) cls += " is-radio";
    if (draft.devices.has(gpu.index)) cls += " is-on";
    const toggle = container.createEl("button", { cls, text: String(gpu.index) });
    if (this.isEditable()) {
      this.tip(toggle, MESSAGES.PLACEMENT_TIP_CHIP(role, gpu.label));
      toggle.addEventListener("click", () => this.toggleDevice(role, gpu.index));
    } else {
      this.makeReadOnly(toggle);
    }
  }
  renderStepper(container, role) {
    const draft = this.draftFor(role);
    const stepper = container.createDiv({ cls: "lilbee-placement-stepper" });
    const dec = stepper.createEl("button", { cls: "lilbee-placement-step", text: "\u2212" });
    stepper.createSpan({ cls: "lilbee-placement-step-count", text: `\xD7${draft.replicas}` });
    const inc = stepper.createEl("button", { cls: "lilbee-placement-step", text: "+" });
    if (this.isEditable()) {
      this.tip(dec, MESSAGES.PLACEMENT_TIP_REPLICA_REMOVE(role));
      this.tip(inc, MESSAGES.PLACEMENT_TIP_REPLICA_ADD(role));
      dec.addEventListener("click", () => this.changeReplicas(role, -1));
      inc.addEventListener("click", () => this.changeReplicas(role, 1));
    } else {
      this.makeReadOnly(dec);
      this.makeReadOnly(inc);
    }
  }
  /** Tooltip via aria-label only: Obsidian renders its own styled tooltip from
   * it. Setting `title` too would stack a second native tooltip on hover. */
  tip(el, text) {
    el.setAttribute("aria-label", text);
  }
  /** A disabled control: greyed, tooltipped with why, and a click explains where
   * to make the change instead (rather than silently doing nothing). */
  makeReadOnly(el) {
    el.addClass("is-readonly");
    this.tip(el, this.readOnlyHint());
    el.addEventListener("click", () => new import_obsidian19.Notice(this.readOnlyHint()));
  }
  /** Why editing is unavailable: enter manual mode on multi-GPU, or use Settings
   * on a single/unified device where there is nothing to assign. */
  readOnlyHint() {
    return this.multiDevice ? MESSAGES.PLACEMENT_HINT_EDIT_MANUALLY : MESSAGES.PLACEMENT_HINT_REPLICAS_SETTINGS;
  }
  clampPct(pct) {
    return Math.min(100, Math.max(0, Math.round(pct)));
  }
  /** Subscribe to the live GPU stats SSE stream; each event moves the bars in
   * place. The stream stays open until the view closes (onClose aborts it) or
   * the server drops it, in which case the bars hold their last values. */
  async subscribeStats() {
    this.statsController = new AbortController();
    try {
      for await (const event of this.plugin.api.gpuStatsStream(this.statsController.signal)) {
        if (event.event === SSE_EVENT.GPU_STATS) {
          const payload = event.data;
          this.applyStats(payload.gpus);
          this.applyNotice(payload.notice ?? null);
        }
      }
    } catch {
    }
  }
  /** Move the notice banner in place without rebuilding the rest of the view. */
  applyNotice(notice) {
    if (notice === this.gpuNotice) return;
    this.gpuNotice = notice;
    if (this.gpuNoticeEl) {
      if (notice) {
        this.gpuNoticeEl.setText(MESSAGES.PLACEMENT_GPU_NOTICE(notice));
        this.tip(this.gpuNoticeEl, MESSAGES.PLACEMENT_GPU_NOTICE_TOOLTIP);
        return;
      }
      this.gpuNoticeEl.detach();
      this.gpuNoticeEl = null;
      return;
    }
    if (!notice || !this.bodyEl) return;
    const el = this.createNoticeEl(this.bodyEl, notice);
    this.bodyEl.insertBefore(el, this.bodyEl.children[1] ?? null);
    this.gpuNoticeEl = el;
  }
  /** Move each card's utilization bar and util/memory text from a live snapshot.
   * Skips devices not currently rendered (a reload rebuilds the cards). */
  applyStats(gpus) {
    for (const gpu of gpus) {
      const refs = this.gpuBars.get(gpu.index);
      if (!refs) continue;
      const pct = gpu.utilization_pct;
      const clamped = pct === null ? 0 : this.clampPct(pct);
      refs.utilFill.setCssProps({ width: `${clamped}%` });
      refs.utilFill.toggleClass("is-active", clamped > 0);
      refs.utilText.setText(pct === null ? MESSAGES.PLACEMENT_UTIL_NA : MESSAGES.PLACEMENT_UTIL(clamped));
      if (refs.vramFill && refs.memText) {
        this.setVram({ fill: refs.vramFill, val: refs.memText }, gpu.free_bytes, gpu.total_bytes);
      }
    }
  }
  /** Chips and replica steppers are editable only in manual mode, which is
   * reachable only on multi-GPU hosts. A single or unified device has nothing to
   * assign — the server rejects a device-less spec — so replica counts there are
   * configured in Settings (Hardware / fleet), not here. */
  isEditable() {
    return this.mode === PLACEMENT_MODE.MANUAL && !this.applying;
  }
  // ---- footer + actions -----------------------------------------------------
  renderFooter(container, data) {
    const footer = container.createDiv({ cls: "lilbee-placement-footer" });
    const fit = footer.createSpan({ cls: "lilbee-placement-fit" });
    fit.createSpan({ cls: "lilbee-placement-fit-dot" });
    const label = fit.createSpan({ cls: "lilbee-placement-fit-label" });
    if (this.unplaceable.length > 0) {
      fit.addClass("is-unfit");
      label.setText(MESSAGES.PLACEMENT_WONT_FIT(this.unplaceable.join(", ")));
    } else if (this.mode === PLACEMENT_MODE.AUTO) {
      fit.addClass("is-muted");
      label.setText(MESSAGES.PLACEMENT_AUTO_MANAGED);
    } else {
      label.setText(MESSAGES.PLACEMENT_FITS);
    }
    this.renderFooterButtons(footer, data);
  }
  renderFooterButtons(footer, data) {
    if (this.mode === PLACEMENT_MODE.AUTO) {
      if (data.gpus.length >= 2) {
        const edit = footer.createEl("button", { cls: "lilbee-placement-btn", text: MESSAGES.PLACEMENT_EDIT });
        edit.addEventListener("click", () => this.enterManual());
      }
      return;
    }
    const preview = footer.createEl("button", { cls: "lilbee-placement-btn", text: MESSAGES.PLACEMENT_PREVIEW });
    preview.addEventListener("click", () => void this.runPreview());
    const apply = footer.createEl("button", {
      cls: "lilbee-placement-btn lilbee-placement-btn-primary",
      text: MESSAGES.PLACEMENT_APPLY
    });
    if (this.applyBlocked()) apply.addClass("is-disabled");
    else apply.addEventListener("click", () => void this.runApply());
    const reset = footer.createEl("button", { cls: "lilbee-placement-btn", text: MESSAGES.PLACEMENT_RESET });
    reset.addEventListener("click", () => void this.runReset());
  }
  applyBlocked() {
    return this.unplaceable.length > 0 || this.applyDisabled || this.applying;
  }
  renderApplyingOverlay(container) {
    const overlay = container.createDiv({ cls: "lilbee-placement-overlay" });
    overlay.createDiv({ cls: "lilbee-placement-spinner" });
    overlay.createDiv({ cls: "lilbee-placement-overlay-text", text: MESSAGES.PLACEMENT_REBUILDING });
  }
  // ---- edit transitions -----------------------------------------------------
  enterManual() {
    this.mode = PLACEMENT_MODE.MANUAL;
    this.render();
  }
  toggleDevice(role, deviceIndex) {
    const draft = this.draftFor(role);
    if (this.isSingleSelect(role)) {
      draft.devices = /* @__PURE__ */ new Set([deviceIndex]);
    } else if (draft.devices.has(deviceIndex)) {
      if (draft.devices.size > 1) draft.devices.delete(deviceIndex);
    } else {
      draft.devices.add(deviceIndex);
    }
    this.render();
    this.schedulePreview();
  }
  changeReplicas(role, delta) {
    const draft = this.draftFor(role);
    draft.replicas = Math.max(1, draft.replicas + delta);
    this.render();
    this.schedulePreview();
  }
  /** True when the draft diverges from the resolved plan we loaded. */
  isEdited(data) {
    for (const role of data.roles) {
      const draft = this.draftFor(role.role);
      if (draft.replicas !== role.replicas) return true;
      if (draft.devices.size !== role.devices.length) return true;
      if (!role.devices.every((d) => draft.devices.has(d))) return true;
    }
    return false;
  }
  /** Build the wire spec covering every drafted role. */
  buildSpec() {
    const spec = {};
    for (const [role, draft] of this.draft) {
      const entry = { devices: [...draft.devices].sort((a, b) => a - b) };
      if (REPLICA_ROLES.has(role)) entry.replicas = draft.replicas;
      spec[role] = entry;
    }
    return spec;
  }
  schedulePreview() {
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      void this.runPreview();
    }, PREVIEW_DEBOUNCE_MS);
  }
  async runPreview() {
    const result = await this.plugin.api.placementPreview(this.buildSpec());
    if (result.isErr()) {
      this.unplaceable = this.unplaceableFrom422(result.error);
      this.render();
      return;
    }
    this.unplaceable = result.value.unplaceable;
    this.render();
  }
  /** The server rejects an impossible pin with a 422 naming the role(s) that
   * won't fit ("chat pinned to device 0 needs N GiB but device 0 has M GiB").
   * Map that to the unplaceable list; on any other error keep the prior state. */
  unplaceableFrom422(error) {
    if (!isHttpStatus(error, HTTP_UNPROCESSABLE)) return this.unplaceable;
    const roles = [...this.draft.keys()].filter((role) => error.message.includes(`${role} pinned to device`));
    return roles.length > 0 ? roles : this.unplaceable;
  }
  async runApply() {
    this.applying = true;
    this.render();
    const result = await this.plugin.api.applyPlacement(this.buildSpec());
    if (result.isErr()) {
      this.applying = false;
      this.handleMutationError(result.error);
      this.render();
      return;
    }
    this.adoptResponse(result.value);
    this.applying = true;
    this.render();
    await this.waitForFleetReady();
    this.applying = false;
    this.render();
    new import_obsidian19.Notice(MESSAGES.PLACEMENT_APPLIED);
  }
  /** Poll health until the fleet reports ready after a placement change; stops
   *  early on an errored/absent health signal so it never blocks indefinitely. */
  async waitForFleetReady() {
    for (let i2 = 0; i2 < 200; i2++) {
      const health = await this.plugin.api.health();
      if (health.isErr() || health.value.chat_ready !== false) return;
      await new Promise((r) => window.setTimeout(r, 1500));
    }
  }
  async runReset() {
    this.applying = true;
    this.render();
    const result = await this.plugin.api.clearPlacement();
    this.applying = false;
    if (result.isErr()) {
      this.handleMutationError(result.error);
      this.render();
      return;
    }
    new import_obsidian19.Notice(MESSAGES.PLACEMENT_RESET_DONE);
    this.adoptResponse(result.value);
  }
  adoptResponse(response) {
    this.current = response;
    this.mode = response.manual ? PLACEMENT_MODE.MANUAL : PLACEMENT_MODE.AUTO;
    this.unplaceable = response.unplaceable;
    this.applyDisabled = false;
    this.seedDraft(response.roles);
    this.render();
  }
  handleMutationError(error) {
    if (isHttpStatus(error, HTTP_CONFLICT)) {
      this.applyDisabled = true;
      new import_obsidian19.Notice(MESSAGES.PLACEMENT_APPLY_NOT_ENABLED);
      return;
    }
    new import_obsidian19.Notice(
      MESSAGES.PLACEMENT_APPLY_FAILED(
        errorMessage(error, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode)
      )
    );
  }
  async onClose() {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    if (this.startupRetryTimer !== null) {
      window.clearTimeout(this.startupRetryTimer);
      this.startupRetryTimer = null;
    }
    if (this.statsController !== null) {
      this.statsController.abort();
      this.statsController = null;
    }
  }
};

// src/views/chat-view.ts
var VIEW_TYPE_CHAT = "lilbee-chat";
var SCROLL_FOLLOW_THRESHOLD_PX = 80;
var COMPACTION_ICON = "chevrons-down-up";
var COMPACTION_LOSSY_ICON = "alert-triangle";
var RAIL_BROWSE_KEY = "__lilbee_browse__";
var RAIL_DISABLED_KEY = "";
function railTriggerLabel(options) {
  return (options.find((o) => o.checked) ?? options[0])?.label ?? "";
}
var OPTIONAL_ROLE_SPECS = [
  {
    task: MODEL_TASK.VISION,
    label: MESSAGES.RAIL_LABEL_VISION,
    dotClass: "is-vision",
    triggerClass: "lilbee-vision-model-select",
    disabledLabel: MESSAGES.LABEL_VISION_DISABLED,
    tooltip: MESSAGES.TOOLTIP_ROLE_VISION,
    configKey: "vision_model",
    setActive: (api, model) => api.setVisionModel(model),
    failNotice: MESSAGES.RAIL_LABEL_VISION
  },
  {
    task: MODEL_TASK.RERANK,
    label: MESSAGES.RAIL_LABEL_RERANK,
    dotClass: "is-rerank",
    triggerClass: "lilbee-rerank-model-select",
    disabledLabel: MESSAGES.LABEL_RERANKER_DISABLED,
    tooltip: MESSAGES.TOOLTIP_ROLE_RERANK,
    configKey: "reranker_model",
    setActive: (api, model) => api.setRerankerModel(model),
    failNotice: MESSAGES.RAIL_LABEL_RERANK
  }
];
function extractString(data, field) {
  if (typeof data === "object" && data !== null && field in data) {
    return String(data[field]);
  }
  return String(data);
}
function extractBanner(data) {
  if (data === null || typeof data !== "object") return null;
  const banner = data.banner;
  return typeof banner === "string" && banner.length > 0 ? banner : null;
}
function plainStream(md) {
  return md.replace(/\*\*/g, "").replace(/`/g, "");
}
function compactionMarkerText(data) {
  if (data.condensed > 0 && data.stranded > 0) return MESSAGES.CHAT_COMPACTED_PARTIAL(data.condensed, data.stranded);
  if (data.stranded > 0) return MESSAGES.CHAT_STRANDED(data.stranded);
  return MESSAGES.CHAT_COMPACTED(data.condensed);
}
var ChatView = class _ChatView extends import_obsidian20.ItemView {
  plugin;
  history = [];
  /** Server-side conversation this view appends to. Null until the first turn opens one. */
  sessionId = null;
  /** Carry-forward compaction notes; sent with each turn and replaced by `compaction` events. */
  summary = "";
  /** Bumped when the transcript is replaced or cleared; stale queued writes check it and no-op. */
  conversationEpoch = 0;
  /** Serializes session writes: the log is append-only, so turns must land in order. */
  persistQueue = Promise.resolve();
  /** The send in progress, so a resume can let it finish unwinding before replacing the transcript. */
  inFlightSend = null;
  messagesEl = null;
  sendBtn = null;
  textareaEl = null;
  sending = false;
  streamController = null;
  pullController = null;
  chatCatalogEntries = [];
  chatInstalled = [];
  chatActive = "";
  chatTriggerTextEl = null;
  embeddingTriggerTextEl = null;
  embeddingModels = [];
  activeEmbeddingModel = "";
  chatModeContainer = null;
  chatModeCurrent = null;
  /** Search-scope toggle buttons by scope. Empty while the wiki feature is off — they aren't rendered then. */
  searchModeButtons = /* @__PURE__ */ new Map();
  // Optional model roles (Vision, Rerank) surfaced in the rail. Keyed by the
  // spec's task; data refreshed alongside the chat/embed selectors. Options
  // come from the per-task catalog (so only role-capable models show), exactly
  // like the Settings model manager.
  optionalRailEl = null;
  optionalCatalog = { vision: [], rerank: [] };
  optionalActive = { vision: "", rerank: "" };
  static OFFLINE_THRESHOLD = 3;
  retryTimer = null;
  retryCount = 0;
  emptyStateEl = null;
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_CHAT;
  }
  getDisplayText() {
    return MESSAGES.LABEL_CHAT_VIEW;
  }
  getIcon() {
    return "message-circle";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("lilbee-chat-container");
    this.createToolbar(container);
    this.messagesEl = container.createDiv({ cls: "lilbee-chat-messages" });
    this.createInputArea(container);
  }
  async onClose() {
    this.streamController?.abort();
    this.pullController?.abort();
    if (this.retryTimer) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryCount = 0;
  }
  createToolbar(container) {
    const toolbar = container.createDiv({ cls: "lilbee-chat-toolbar" });
    const rail = toolbar.createDiv({ cls: "lilbee-model-rail" });
    const chatChip = rail.createDiv({ cls: "lilbee-model-chip lilbee-toolbar-group" });
    chatChip.setAttribute("aria-label", MESSAGES.TOOLTIP_ROLE_CHAT);
    chatChip.setAttribute("aria-label-position", "top");
    chatChip.createSpan({ cls: "lilbee-model-chip-dot is-chat is-active" });
    chatChip.createSpan({ cls: "lilbee-model-chip-label", text: MESSAGES.RAIL_LABEL_CHAT });
    this.chatTriggerTextEl = this.createRailTrigger(
      chatChip,
      "lilbee-chat-model-select",
      (event) => this.openChatMenu(event)
    );
    const embedChip = rail.createDiv({ cls: "lilbee-model-chip lilbee-toolbar-group lilbee-toolbar-group-embed" });
    embedChip.setAttribute("aria-label", MESSAGES.TOOLTIP_ROLE_EMBED);
    embedChip.setAttribute("aria-label-position", "top");
    embedChip.createSpan({ cls: "lilbee-model-chip-dot is-embed is-active" });
    embedChip.createSpan({ cls: "lilbee-model-chip-label", text: MESSAGES.RAIL_LABEL_EMBED });
    this.embeddingTriggerTextEl = this.createRailTrigger(
      embedChip,
      "lilbee-embed-model-select",
      (event) => this.openEmbeddingMenu(event)
    );
    this.optionalRailEl = rail.createDiv({ cls: "lilbee-model-rail-optional" });
    this.fillOptionalRoles();
    const railBrowseBtn = rail.createEl("button", {
      text: MESSAGES.BUTTON_BROWSE_MORE,
      cls: "lilbee-embed-browse lilbee-rail-browse"
    });
    railBrowseBtn.setAttribute("aria-label", MESSAGES.BUTTON_BROWSE_MORE);
    railBrowseBtn.addEventListener("click", () => {
      new CatalogModal(this.app, this.plugin).open();
    });
    const actions = toolbar.createDiv({ cls: "lilbee-chat-toolbar-actions" });
    this.chatModeContainer = actions.createDiv({ cls: "lilbee-chat-mode-container" });
    this.fetchAndFillSelectors();
    const wikiEnabled = this.plugin.settings.wikiEnabled;
    if (!wikiEnabled && this.plugin.settings.searchChunkType === SEARCH_CHUNK_TYPE.WIKI) {
      this.plugin.settings.searchChunkType = SEARCH_CHUNK_TYPE.ALL;
    }
    if (wikiEnabled) {
      const modeGroup = actions.createDiv({ cls: "lilbee-search-mode" });
      const modes = [
        { value: SEARCH_CHUNK_TYPE.ALL, label: MESSAGES.LABEL_SEARCH_ALL },
        { value: SEARCH_CHUNK_TYPE.WIKI, label: MESSAGES.LABEL_SEARCH_WIKI },
        { value: SEARCH_CHUNK_TYPE.RAW, label: MESSAGES.LABEL_SEARCH_RAW }
      ];
      for (const mode of modes) {
        const btn = modeGroup.createEl("button", { text: mode.label, cls: "lilbee-search-mode-btn" });
        this.searchModeButtons.set(mode.value, btn);
        btn.addEventListener("click", () => {
          this.plugin.settings.searchChunkType = mode.value;
          void this.plugin.saveSettings();
          this.syncSearchModeButtons(mode.value);
        });
      }
      this.syncSearchModeButtons(this.plugin.settings.searchChunkType);
    }
    actions.createDiv({ cls: "lilbee-toolbar-spacer" });
    const gpuBtn = actions.createEl("button", { cls: "lilbee-chat-gpu" });
    (0, import_obsidian20.setIcon)(gpuBtn, "cpu");
    gpuBtn.setAttribute("aria-label", MESSAGES.LABEL_OPEN_GPU_ACTIVITY);
    gpuBtn.addEventListener("click", () => void revealPlacementBeside(this.app, this.leaf));
    if (this.plugin.serverSupportsSessions()) {
      const sessionsBtn = actions.createEl("button", { cls: "lilbee-chat-sessions" });
      (0, import_obsidian20.setIcon)(sessionsBtn, "history");
      sessionsBtn.setAttribute("aria-label", MESSAGES.LABEL_OPEN_SESSIONS);
      sessionsBtn.addEventListener("click", () => this.openSessions());
    }
    const saveBtn = actions.createEl("button", { cls: "lilbee-chat-save" });
    (0, import_obsidian20.setIcon)(saveBtn, "save");
    saveBtn.setAttribute("aria-label", MESSAGES.LABEL_SAVE_VAULT);
    saveBtn.addEventListener("click", () => void this.saveToVault());
    const clearBtn = actions.createEl("button", { cls: "lilbee-chat-clear" });
    (0, import_obsidian20.setIcon)(clearBtn, "eraser");
    clearBtn.setAttribute("aria-label", MESSAGES.BUTTON_CLEAR_CHAT);
    clearBtn.addEventListener("click", () => this.clearChat());
  }
  createInputArea(container) {
    const inputArea = container.createDiv({ cls: "lilbee-chat-input" });
    const addBtn = inputArea.createEl("button", { cls: "lilbee-chat-add-file" });
    addBtn.setAttribute("aria-label", MESSAGES.LABEL_ADD_FILE);
    (0, import_obsidian20.setIcon)(addBtn, "paperclip");
    addBtn.addEventListener("click", (e) => this.openFilePicker(e));
    const textarea = inputArea.createEl("textarea", {
      placeholder: MESSAGES.PLACEHOLDER_ASK_SOMETHING,
      cls: "lilbee-chat-textarea"
    });
    this.textareaEl = textarea;
    this.sendBtn = inputArea.createEl("button", {
      text: MESSAGES.BUTTON_SEND,
      cls: "lilbee-chat-send"
    });
    const handleSend = () => {
      try {
        if (this.sending) return;
        const text = textarea.value.trim();
        if (!text) return;
        this.inFlightSend = this.sendMessage(text);
      } catch (err3) {
        const reason = errorMessage(err3, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
        new import_obsidian20.Notice(MESSAGES.ERROR_CHAT_FAILED(reason));
      }
    };
    this.sendBtn.addEventListener("click", () => {
      if (this.sending) {
        this.streamController?.abort();
      } else {
        handleSend();
      }
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  }
  fetchAndFillSelectors() {
    Promise.all([
      this.plugin.api.catalog({ task: MODEL_TASK.CHAT }),
      this.plugin.api.installedModels({ task: MODEL_TASK.CHAT }).catch(() => ({ models: [] })),
      this.plugin.api.catalog({ task: MODEL_TASK.EMBEDDING }).catch(() => null),
      this.plugin.api.config().catch(() => null),
      this.plugin.api.catalog({ task: MODEL_TASK.VISION }).catch(() => null),
      this.plugin.api.catalog({ task: MODEL_TASK.RERANK }).catch(() => null)
    ]).then(([chatCatalogResult, chatInstalled, embeddingResult, serverConfig, visionCatalog, rerankCatalog]) => {
      if (this.retryTimer) {
        window.clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      this.retryCount = 0;
      this.chatCatalogEntries = chatCatalogResult.isOk() ? chatCatalogResult.value.models : [];
      this.chatInstalled = chatInstalled.models;
      this.chatActive = serverConfig ? configString(serverConfig, "chat_model") : "";
      this.chatTriggerTextEl?.setText(railTriggerLabel(this.chatOptionGroups().flat()));
      this.fillEmbeddingSelector(embeddingResult, serverConfig);
      this.fillOptionalRoleData(
        visionCatalog && visionCatalog.isOk() ? visionCatalog.value.models : [],
        rerankCatalog && rerankCatalog.isOk() ? rerankCatalog.value.models : [],
        serverConfig
      );
      this.renderChatModeToggle(serverConfig);
      if (this.chatInstalled.length === 0) {
        this.showEmptyState();
        this.retryTimer = window.setTimeout(() => this.fetchAndFillSelectors(), RETRY_INTERVAL_MS);
      } else {
        this.hideEmptyState();
      }
    }).catch(() => {
      this.retryCount++;
      const connecting = this.retryCount < _ChatView.OFFLINE_THRESHOLD;
      const label = connecting ? MESSAGES.LABEL_CONNECTING : MESSAGES.LABEL_OFFLINE;
      this.chatCatalogEntries = [];
      this.chatInstalled = [];
      this.embeddingModels = [];
      this.activeEmbeddingModel = "";
      this.chatTriggerTextEl?.setText(label);
      this.embeddingTriggerTextEl?.setText(label);
      if (this.retryCount === _ChatView.OFFLINE_THRESHOLD) {
        new import_obsidian20.Notice(MESSAGES.ERROR_SERVER_UNREACHABLE);
      }
      this.retryTimer = window.setTimeout(() => this.fetchAndFillSelectors(), RETRY_INTERVAL_MS);
    });
  }
  renderChatModeToggle(serverConfig) {
    if (!this.chatModeContainer) return;
    this.chatModeContainer.empty();
    const rawMode = serverConfig?.chat_mode;
    if (rawMode !== CHAT_MODE.SEARCH && rawMode !== CHAT_MODE.CHAT) return;
    this.chatModeCurrent = rawMode;
    const embeddingModel = typeof serverConfig?.embedding_model === "string" ? serverConfig.embedding_model : "";
    const noEmbedding = embeddingModel === "";
    const segments = [
      { mode: CHAT_MODE.SEARCH, label: MESSAGES.LABEL_CHAT_MODE_SEARCH, tooltip: MESSAGES.TOOLTIP_MODE_SEARCH },
      { mode: CHAT_MODE.CHAT, label: MESSAGES.LABEL_CHAT_MODE_CHAT, tooltip: MESSAGES.TOOLTIP_MODE_CHAT }
    ];
    for (const seg of segments) {
      const btn = this.chatModeContainer.createEl("button", {
        text: seg.label,
        cls: `lilbee-chat-mode-btn${seg.mode === rawMode ? " active" : ""}`
      });
      btn.setAttribute("aria-label", seg.tooltip);
      btn.setAttribute("aria-label-position", "top");
      if (noEmbedding) {
        btn.disabled = true;
        btn.setAttribute("title", MESSAGES.TOOLTIP_CHAT_MODE_NEEDS_EMBEDDING);
        btn.addClass("lilbee-disabled");
      }
      btn.addEventListener("click", () => {
        if (noEmbedding || seg.mode === this.chatModeCurrent) return;
        void this.persistChatMode(seg.mode);
      });
    }
  }
  async persistChatMode(mode) {
    try {
      await this.plugin.api.updateConfig({ [CONFIG_KEY.CHAT_MODE]: mode });
      this.chatModeCurrent = mode;
      this.applyActiveClassToChatModeButtons(mode);
    } catch (err3) {
      const reason = errorMessage(err3, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
      new import_obsidian20.Notice(MESSAGES.NOTICE_FAILED_UPDATE(`${MESSAGES.LABEL_CHAT_MODE}: ${reason}`));
    }
  }
  applyActiveClassToChatModeButtons(mode) {
    if (!this.chatModeContainer) return;
    const buttons = this.chatModeContainer.querySelectorAll(".lilbee-chat-mode-btn");
    const activeIdx = mode === CHAT_MODE.SEARCH ? 0 : 1;
    for (let i2 = 0; i2 < buttons.length; i2++) {
      if (i2 === activeIdx) buttons[i2].addClass("active");
      else buttons[i2].removeClass("active");
    }
  }
  fillEmbeddingSelector(embeddingResult, serverConfig) {
    this.activeEmbeddingModel = serverConfig ? configString(serverConfig, "embedding_model") : "";
    this.embeddingModels = embeddingResult && embeddingResult.isOk() ? embeddingResult.value.models.filter((m) => m.installed) : [];
    this.embeddingTriggerTextEl?.setText(railTriggerLabel(this.embeddingOptions()));
  }
  /** Embedding menu entries: installed builds, or the bare active ref when none are installed. */
  embeddingOptions() {
    const activeRepo = extractHfRepo(this.activeEmbeddingModel);
    const options = this.embeddingModels.map((m) => ({
      value: m.hf_repo,
      label: m.display_name,
      checked: m.hf_repo === activeRepo
    }));
    if (options.length === 0 && this.activeEmbeddingModel) {
      options.push({
        value: this.activeEmbeddingModel,
        label: displayLabelForRef(this.activeEmbeddingModel),
        checked: true
      });
    }
    return options;
  }
  /** Chat menu entries: [featured installed + hosted rows, other installed builds]. */
  chatOptionGroups() {
    return [this.chatPrimaryOptions(), this.chatOtherOptions()];
  }
  /** Featured rows that have an installed quant, then hosted rows not already listed. */
  chatPrimaryOptions() {
    const installedRepos = new Set(this.chatInstalled.map((m) => extractHfRepo(m.name)));
    const activeRepo = extractHfRepo(this.chatActive);
    const primary = [];
    for (const entry of this.chatCatalogEntries.filter((e) => installedRepos.has(e.hf_repo))) {
      const sourceTag = HOSTED_SOURCES.has(entry.source) ? ` [${entry.provider ?? entry.source}]` : "";
      primary.push({
        value: entry.hf_repo,
        label: `${entry.display_name}${sourceTag}`,
        checked: entry.hf_repo === activeRepo
      });
    }
    for (const [ref, label] of hostedOptions(this.chatCatalogEntries)) {
      if (installedRepos.has(ref)) continue;
      primary.push({ value: ref, label, checked: ref === activeRepo });
    }
    return primary;
  }
  /** Installed builds that aren't in the featured catalog (manually pulled, ollama/, openai/, …). */
  chatOtherOptions() {
    const sourceMap = new Map(this.chatInstalled.map((m) => [m.name, m.source]));
    const featuredRepos = new Set(this.chatCatalogEntries.map((e) => e.hf_repo));
    return this.chatInstalled.filter((m) => !featuredRepos.has(extractHfRepo(m.name))).sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
      const source = sourceMap.get(m.name);
      const suffix = source && source !== CATALOG_SOURCE.NATIVE ? ` [${source}]` : "";
      return {
        value: m.name,
        label: `${displayLabelForRef(m.name)}${suffix}`,
        checked: m.name === this.chatActive
      };
    });
  }
  openChatMenu(event) {
    this.openRailMenu(
      event,
      this.chatTriggerTextEl,
      this.chatOptionGroups(),
      (value) => this.handleChatSelection(value)
    );
  }
  handleChatSelection(value) {
    const uninstalled = this.chatCatalogEntries.find((e) => e.hf_repo === value && !e.installed);
    if (uninstalled) {
      const modal = new ConfirmPullModal(this.plugin.app, {
        displayName: uninstalled.display_name,
        sizeGb: uninstalled.size_gb,
        minRamGb: uninstalled.min_ram_gb,
        systemMemGb: getRelevantSystemMemoryGB(this.plugin.settings.serverMode)
      });
      modal.open();
      void modal.result.then((confirmed) => {
        if (confirmed) {
          void this.autoPullAndSet(uninstalled);
        }
      });
      return;
    }
    this.applyChatModel(value);
  }
  /** Point the server at an already-installed chat model. */
  applyChatModel(value) {
    void this.plugin.api.setChatModel(value).then((result) => {
      if (result.isOk()) {
        this.chatActive = value;
        this.plugin.activeModel = value;
        void this.plugin.fetchActiveModel();
        this.plugin.refreshSettingsTab();
      } else {
        new import_obsidian20.Notice(MESSAGES.ERROR_SWITCH_MODEL);
      }
    });
  }
  openEmbeddingMenu(event) {
    this.openRailMenu(
      event,
      this.embeddingTriggerTextEl,
      [this.embeddingOptions()],
      (value) => this.handleEmbeddingSelection(value)
    );
  }
  handleEmbeddingSelection(value) {
    const previous = this.activeEmbeddingModel;
    const modal = new ConfirmModal(this.plugin.app, MESSAGES.DESC_EMBEDDING_REINDEX_WARNING);
    modal.open();
    void modal.result.then(async (confirmed) => {
      if (!confirmed) {
        this.revertEmbeddingTrigger(previous);
        return;
      }
      const result = await this.plugin.api.setEmbeddingModel(value);
      if (result.isErr()) {
        new import_obsidian20.Notice(noticeForResultError(result.error, MESSAGES.NOTICE_FAILED_EMBEDDING));
        this.revertEmbeddingTrigger(previous);
        return;
      }
      this.activeEmbeddingModel = value;
      new import_obsidian20.Notice(MESSAGES.NOTICE_EMBEDDING_UPDATED);
      new import_obsidian20.Notice(MESSAGES.NOTICE_REINDEX_REQUIRED);
      this.plugin.refreshSettingsTab();
      void this.plugin.triggerSync();
    });
  }
  /** Chip trigger button: current model text + caret; click opens the role's menu. */
  createRailTrigger(chip, cls, onOpen) {
    const trigger = chip.createEl("button", { cls: `lilbee-model-chip-select ${cls}` });
    const text = trigger.createSpan({ cls: "lilbee-model-chip-select-text" });
    (0, import_obsidian20.setIcon)(trigger.createSpan({ cls: "lilbee-model-chip-select-caret" }), "chevron-down");
    trigger.addEventListener("click", (event) => onOpen(event, text));
    return text;
  }
  /** In-window menu of rail options; the checked entry is the active one. */
  openRailMenu(event, textEl, groups, onPick) {
    const nonEmpty = groups.filter((group) => group.length > 0);
    if (nonEmpty.length === 0) return;
    const menu = new import_obsidian20.Menu();
    nonEmpty.forEach((group, index) => {
      if (index > 0) menu.addSeparator();
      for (const opt of group) {
        menu.addItem((item) => {
          item.setTitle(opt.label).setChecked(opt.checked).onClick(() => {
            if (opt.checked) return;
            if (opt.value !== RAIL_BROWSE_KEY) textEl?.setText(opt.label);
            onPick(opt.value);
          });
        });
      }
    });
    this.showMenu(menu, event);
  }
  /** Store the latest per-task catalog + active model for the optional roles, then re-render. */
  fillOptionalRoleData(visionCatalog, rerankCatalog, serverConfig) {
    this.optionalCatalog.vision = visionCatalog;
    this.optionalCatalog.rerank = rerankCatalog;
    this.optionalActive.vision = serverConfig ? configString(serverConfig, "vision_model") : "";
    this.optionalActive.rerank = serverConfig ? configString(serverConfig, "reranker_model") : "";
    this.fillOptionalRoles();
  }
  /** Rebuild the optional (Vision, Rerank) rail rows from current catalog/active state. */
  fillOptionalRoles() {
    if (!this.optionalRailEl) return;
    this.optionalRailEl.empty();
    for (const spec of OPTIONAL_ROLE_SPECS) {
      this.renderOptionalRoleRow(this.optionalRailEl, spec);
    }
  }
  /**
   * Selectable models for a role: local installed builds + hosted (LiteLLM)
   * entries — mirroring the Settings model manager so only role-capable
   * models appear. Un-installed catalog builds are reached via "Browse catalog".
   */
  optionalRoleOptions(spec) {
    const entries = this.optionalCatalog[spec.task];
    const localInstalled = entries.filter((e) => !HOSTED_SOURCES.has(e.source) && e.installed);
    const hosted = entries.filter(isUsableHostedRow);
    const options = localInstalled.map((e) => ({ value: e.hf_repo, label: e.display_name }));
    for (const e of hosted) {
      options.push({ value: e.hf_repo, label: `${e.display_name} \u2014 ${MESSAGES.LABEL_VISION_HOSTED_GROUP}` });
    }
    return options;
  }
  /** Full menu entry list for an optional role: Disabled, role-capable models, Browse catalog. */
  optionalRoleMenuOptions(spec) {
    const active = this.optionalActive[spec.task];
    const activeRepo = extractHfRepo(active);
    const options = [{ value: RAIL_DISABLED_KEY, label: spec.disabledLabel, checked: !active }];
    for (const opt of this.optionalRoleOptions(spec)) {
      options.push({ ...opt, checked: opt.value === active || opt.value === activeRepo });
    }
    options.push({ value: RAIL_BROWSE_KEY, label: MESSAGES.RAIL_BROWSE_CATALOG, checked: false });
    return options;
  }
  renderOptionalRoleRow(rail, spec) {
    const active = this.optionalActive[spec.task];
    const chip = rail.createDiv({ cls: "lilbee-model-chip lilbee-model-chip-optional" });
    chip.setAttribute("aria-label", spec.tooltip);
    chip.setAttribute("aria-label-position", "top");
    if (!active) chip.addClass("is-off");
    const dot = chip.createSpan({ cls: `lilbee-model-chip-dot ${spec.dotClass}` });
    if (active) dot.addClass("is-active");
    chip.createSpan({ cls: "lilbee-model-chip-label", text: spec.label });
    const textEl = this.createRailTrigger(
      chip,
      spec.triggerClass,
      (event, text) => this.openRailMenu(
        event,
        text,
        [this.optionalRoleMenuOptions(spec)],
        (value) => this.handleOptionalRoleSelection(spec, value)
      )
    );
    textEl.setText(railTriggerLabel(this.optionalRoleMenuOptions(spec)));
  }
  handleOptionalRoleSelection(spec, value) {
    if (value === RAIL_BROWSE_KEY) {
      new CatalogModal(this.app, this.plugin, spec.task).open();
      return;
    }
    void spec.setActive(this.plugin.api, value).then((result) => {
      if (result.isErr()) {
        new import_obsidian20.Notice(MESSAGES.NOTICE_FAILED_UPDATE(spec.failNotice));
        return;
      }
      this.optionalActive[spec.task] = value;
      this.fillOptionalRoles();
      void this.plugin.fetchActiveModel();
      this.plugin.refreshSettingsTab();
    });
  }
  revertEmbeddingTrigger(previousValue) {
    if (!this.embeddingTriggerTextEl) return;
    const option = this.embeddingOptions().find((opt) => opt.value === previousValue);
    if (option) {
      this.embeddingTriggerTextEl.setText(option.label);
      return;
    }
    void this.fetchAndFillSelectors();
  }
  async autoPullAndSet(entry) {
    const taskId = this.plugin.taskQueue.enqueue(`Pull ${entry.display_name}`, TASK_TYPE.PULL);
    if (taskId === null) {
      new import_obsidian20.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    this.pullController = new AbortController();
    this.plugin.taskQueue.registerAbort(taskId, this.pullController);
    let pullFailed = false;
    try {
      for await (const event of this.plugin.api.pullModel(entry.hf_repo, "native", this.pullController.signal)) {
        if (event.event === SSE_EVENT.PROGRESS) {
          const d = event.data;
          const pct = percentFromSse(d);
          if (pct !== void 0) {
            this.plugin.taskQueue.update(taskId, pct, entry.display_name, {
              current: d.current,
              total: d.total
            });
          }
        } else if (event.event === SSE_EVENT.ERROR) {
          const d = event.data;
          const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
          new import_obsidian20.Notice(MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name));
          this.plugin.taskQueue.fail(taskId, msg);
          pullFailed = true;
          break;
        }
      }
    } catch (err3) {
      if (err3 instanceof Error && err3.name === ERROR_NAME.ABORT_ERROR) {
        new import_obsidian20.Notice(MESSAGES.NOTICE_PULL_CANCELLED);
        this.plugin.taskQueue.cancel(taskId);
      } else {
        const reason = errorMessage(err3, MESSAGES.ERROR_UNKNOWN);
        new import_obsidian20.Notice(`${MESSAGES.ERROR_PULL_MODEL.replace("{model}", entry.display_name)}: ${reason}`);
        this.plugin.taskQueue.fail(taskId, reason);
      }
      this.pullController = null;
      return;
    }
    this.pullController = null;
    if (pullFailed) return;
    this.plugin.taskQueue.complete(taskId);
    const result = await this.plugin.api.setChatModel(entry.hf_repo);
    if (result.isErr()) {
      new import_obsidian20.Notice(
        noticeForResultError(result.error, MESSAGES.ERROR_SET_MODEL.replace("{model}", entry.display_name))
      );
    } else {
      this.plugin.activeModel = entry.hf_repo;
      new import_obsidian20.Notice(MESSAGES.NOTICE_MODEL_ACTIVATED_FULL(entry.display_name));
      this.plugin.refreshSettingsTab();
    }
    void this.plugin.fetchActiveModel();
    this.fetchAndFillSelectors();
  }
  // Re-sync the rail pills with the server's active models, for callers
  // outside this view (e.g. the catalog) that switch a model.
  refreshRail() {
    this.fetchAndFillSelectors();
  }
  clearChat() {
    this.history = [];
    this.sessionId = null;
    this.summary = "";
    this.conversationEpoch++;
    if (this.messagesEl) this.messagesEl.empty();
  }
  openSessions() {
    new SessionsModal(this.app, this.plugin, {
      activeId: this.sessionId,
      resume: (id) => void this.resumeSession(id),
      startNew: () => this.startNewConversation()
    }).open();
  }
  /** Drop the transcript and unbind the session. The old one is already persisted. */
  startNewConversation() {
    this.clearChat();
    new import_obsidian20.Notice(MESSAGES.NOTICE_SESSION_NEW);
  }
  /** Open the session lazily, on the first turn, so an idle view creates nothing. Returns its id. */
  async ensureSession(firstText) {
    if (this.sessionId) return this.sessionId;
    const epoch = this.conversationEpoch;
    const scope = scopeFromChunkType(this.plugin.settings.searchChunkType);
    const created = await this.plugin.api.createSession(this.chatActive, scope);
    if (epoch === this.conversationEpoch) this.sessionId = created.meta.id;
    try {
      await this.plugin.api.renameSession(created.meta.id, deriveSessionTitle(firstText));
    } catch {
    }
    return created.meta.id;
  }
  /** Queue a session write. Never awaited by the chat path: persistence must not stall the answer. */
  queuePersist(write) {
    if (!this.plugin.serverSupportsSessions()) return;
    const epoch = this.conversationEpoch;
    this.persistQueue = this.persistQueue.then(() => epoch === this.conversationEpoch ? write() : void 0).catch((err3) => {
      if (epoch !== this.conversationEpoch) return;
      if (err3 instanceof Error && isHttpStatus(err3, 404)) this.sessionId = null;
    });
  }
  async persistTurn(sessionId, role, content, sources = []) {
    if (!sessionId) return;
    await this.plugin.api.appendSessionMessage(sessionId, role, content, sources);
  }
  async resumeSession(id) {
    let detail;
    try {
      detail = await this.plugin.api.getSession(id);
    } catch (err3) {
      const reason = errorMessage(err3, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode);
      new import_obsidian20.Notice(MESSAGES.ERROR_SESSION_RESUME_FAILED(reason));
      return;
    }
    if (this.sending) {
      this.streamController?.abort();
      await this.inFlightSend;
    }
    this.clearChat();
    this.sessionId = detail.meta.id;
    this.summary = detail.summary;
    this.hideEmptyState();
    if (detail.summary) this.renderSummaryBoundary(detail.summary);
    for (const message of detail.messages) {
      this.renderRestoredMessage(message);
      this.history.push({ role: message.role, content: message.content });
    }
    this.restoreScope(detail.meta.scope);
    this.restoreModel(detail.meta.model_ref);
    if (this.messagesEl) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    new import_obsidian20.Notice(MESSAGES.NOTICE_SESSION_RESUMED(detail.meta.title));
  }
  /** Never point chat at a model that isn't installed; keep the current one and say so. */
  restoreModel(modelRef) {
    if (!modelRef || modelRef === this.chatActive) return;
    if (this.chatInstalled.some((m) => m.name === modelRef)) {
      this.applyChatModel(modelRef);
      return;
    }
    new import_obsidian20.Notice(MESSAGES.NOTICE_SESSION_MODEL_UNAVAILABLE(modelRef, this.chatActive));
  }
  /** Wiki scope is unreachable with the wiki feature off, so a wiki-scoped session keeps the current one. */
  restoreScope(scope) {
    const chunkType = chunkTypeFromScope(scope);
    if (!chunkType || chunkType === this.plugin.settings.searchChunkType) return;
    if (chunkType === SEARCH_CHUNK_TYPE.WIKI && !this.plugin.settings.wikiEnabled) return;
    this.plugin.settings.searchChunkType = chunkType;
    void this.plugin.saveSettings();
    this.syncSearchModeButtons(chunkType);
  }
  /** Move the toggle's highlight to `active`, whether a click or a session resume changed it. */
  syncSearchModeButtons(active) {
    for (const [value, btn] of this.searchModeButtons) btn.toggleClass("active", value === active);
  }
  /** The card shown while the server condenses: what is happening, and how far along. */
  openCompactionMarker(state) {
    if (!this.messagesEl || state.compaction) return;
    const root = this.messagesEl.createDiv({ cls: "lilbee-chat-compaction is-condensing" });
    root.setAttribute("title", MESSAGES.TOOLTIP_COMPACTION);
    const head = root.createDiv({ cls: "lilbee-chat-compaction-head" });
    (0, import_obsidian20.setIcon)(head.createSpan({ cls: "lilbee-chat-compaction-icon" }), COMPACTION_ICON);
    const title = head.createSpan({ text: MESSAGES.CHAT_COMPACTING });
    const bar = root.createDiv({ cls: "lilbee-progress-bar-container" });
    const fill = bar.createDiv({ cls: "lilbee-progress-bar lilbee-progress-indeterminate" });
    this.messagesEl.insertBefore(root, state.anchorEl);
    state.compaction = { root, title, fill };
  }
  /** Count batches in the label. The bar stays indeterminate: each batch is a
   *  model call with no knowable duration, and a fill that reads full while the
   *  work continues is both wrong and dead-looking. */
  advanceCompactionMarker(state, progress) {
    const marker = state.compaction;
    if (!marker || progress.batch === void 0 || progress.batches === void 0) return;
    if (progress.batches <= 1) return;
    marker.title.setText(MESSAGES.CHAT_COMPACTING_PROGRESS(progress.batch, progress.batches));
  }
  /** Collapse the working card into the quiet boundary the transcript keeps. */
  settleCompactionMarker(state, data) {
    const marker = state.compaction;
    if (!marker) return;
    marker.root.empty();
    marker.root.removeClass("is-condensing");
    marker.root.addClass("is-done");
    if (data.stranded > 0) marker.root.addClass("is-lossy");
    const pill = marker.root.createSpan({ cls: "lilbee-chat-compaction-pill" });
    (0, import_obsidian20.setIcon)(
      pill.createSpan({ cls: "lilbee-chat-compaction-icon" }),
      data.stranded > 0 ? COMPACTION_LOSSY_ICON : COMPACTION_ICON
    );
    pill.createSpan({ text: compactionMarkerText(data) });
  }
  renderRestoredMessage(message) {
    if (!this.messagesEl) return;
    if (message.role === SESSION_ROLE.USER) {
      const bubble2 = this.messagesEl.createDiv({ cls: "lilbee-chat-message user" });
      bubble2.createEl("p", { text: message.content });
      return;
    }
    const bubble = this.messagesEl.createDiv({ cls: "lilbee-chat-message assistant" });
    const textEl = bubble.createDiv({ cls: "lilbee-chat-content" });
    void this.renderMarkdown(textEl, message.content);
    if (message.sources.length > 0) this.renderRestoredSources(bubble, message.sources);
  }
  /** Persisted sources are bare paths, so restored chips link out without the live chunk detail. */
  renderRestoredSources(container, sources) {
    const chipsEl = this.createSourcesBlock(container);
    for (const path of sources) {
      const chip = chipsEl.createSpan({ cls: "lilbee-source-chip" });
      chip.createSpan({ text: path, cls: "lilbee-source-chip-file" });
      chip.addEventListener("click", () => void this.app.workspace.openLinkText(path, ""));
    }
  }
  renderSummaryBoundary(summary) {
    if (!this.messagesEl) return;
    const el = this.messagesEl.createDiv({ cls: "lilbee-chat-summary" });
    el.createDiv({ cls: "lilbee-chat-summary-label", text: MESSAGES.LABEL_SESSION_SUMMARY });
    el.createDiv({ cls: "lilbee-chat-summary-body", text: summary });
  }
  async sendMessage(text) {
    if (!this.messagesEl || this.sending) return;
    if (!this.plugin.assertFleetReady()) return;
    if (this.textareaEl) this.textareaEl.value = "";
    this.sending = true;
    this.streamController = new AbortController();
    this.plugin.notifyChatStart();
    if (this.sendBtn) this.sendBtn.setText(MESSAGES.BUTTON_STOP);
    if (this.textareaEl) this.textareaEl.disabled = true;
    const userBubble = this.messagesEl.createDiv({ cls: "lilbee-chat-message user" });
    userBubble.createEl("p", { text });
    this.history.push({ role: "user", content: text });
    this.queuePersist(async () => {
      const sessionId = await this.ensureSession(text);
      await this.persistTurn(sessionId, SESSION_ROLE.USER, text);
    });
    const assistantBubble = this.messagesEl.createDiv({ cls: "lilbee-chat-message assistant" });
    const spinner = assistantBubble.createDiv({ cls: "lilbee-thinking-dots" });
    spinner.createDiv({ cls: "lilbee-thinking-dot" });
    spinner.createDiv({ cls: "lilbee-thinking-dot" });
    spinner.createDiv({ cls: "lilbee-thinking-dot" });
    const textEl = assistantBubble.createDiv({ cls: "lilbee-chat-content" });
    textEl.hide();
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    const state = {
      fullContent: "",
      reasoningContent: "",
      sources: [],
      renderPending: false,
      reasoningRenderPending: false,
      reasoningContentEl: null,
      reasoningDetailsEl: null,
      answerStarted: false,
      streamEnded: false,
      anchorEl: userBubble,
      compaction: null,
      spinnerEl: spinner,
      warmingShown: false
    };
    const spinnerCreatedAt = Date.now();
    const revealContent = () => {
      const elapsed = Date.now() - spinnerCreatedAt;
      const delay = Math.max(0, SPINNER_MIN_DISPLAY_MS - elapsed);
      window.setTimeout(() => {
        void this.renderFollowing(() => {
          if (spinner.parentElement) spinner.remove();
          textEl.show();
        });
      }, delay);
    };
    const scheduleRender = () => {
      if (state.renderPending) return;
      state.renderPending = true;
      window.requestAnimationFrame(() => {
        state.renderPending = false;
        if (state.streamEnded) return;
        void this.renderFollowing(() => textEl.setText(plainStream(state.fullContent)));
      });
    };
    try {
      for await (const event of this.plugin.api.chatStream(
        text,
        this.history.slice(0, -1),
        this.plugin.settings.topK,
        this.streamController.signal,
        void 0,
        this.plugin.settings.searchChunkType,
        { summary: this.summary, sessionId: this.sessionId }
      )) {
        this.handleStreamEvent(event, textEl, assistantBubble, state, revealContent, scheduleRender);
      }
    } catch (err3) {
      if (this.streamController?.signal.aborted || err3 instanceof Error && err3.name === ERROR_NAME.ABORT_ERROR) {
        revealContent();
        state.streamEnded = true;
        state.reasoningDetailsEl?.removeAttribute("open");
        if (state.fullContent) {
          void this.renderMarkdown(textEl, `${state.fullContent}

${MESSAGES.LABEL_STOPPED_MD}`);
          this.history.push({ role: "assistant", content: state.fullContent });
        } else {
          textEl.setText(MESSAGES.LABEL_STOPPED);
        }
      } else if (err3 instanceof RateLimitedError) {
        this.renderInlineError(assistantBubble, MESSAGES.ERROR_RATE_LIMITED(err3.retryAfterSeconds));
      } else if (isStreamInterruptedError(err3)) {
        this.renderInlineError(assistantBubble, streamInterruptedMessage(this.plugin.settings.serverMode));
      } else {
        this.renderInlineError(
          assistantBubble,
          MESSAGES.ERROR_CHAT_FAILED(
            errorMessage(err3, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode)
          )
        );
      }
    } finally {
      state.streamEnded = true;
      this.sending = false;
      this.streamController = null;
      this.plugin.notifyChatEnd();
      if (this.sendBtn) {
        this.sendBtn.setText(MESSAGES.BUTTON_SEND);
      }
      if (this.textareaEl) this.textareaEl.disabled = false;
    }
  }
  handleStreamEvent(event, textEl, assistantBubble, state, revealContent, scheduleRender) {
    switch (event.event) {
      case SSE_EVENT.WARMING: {
        if (!state.warmingShown) {
          state.warmingShown = true;
          void this.renderFollowing(() => {
            state.spinnerEl.createDiv({ cls: "lilbee-chat-warming-label", text: MESSAGES.CHAT_WARMING });
          });
        }
        break;
      }
      case SSE_EVENT.COMPACTING: {
        const progress = event.data;
        void this.renderFollowing(() => {
          this.openCompactionMarker(state);
          this.advanceCompactionMarker(state, progress);
        });
        break;
      }
      case SSE_EVENT.COMPACTION: {
        const data = event.data;
        this.summary = data.summary;
        this.history.splice(0, data.condensed + data.stranded);
        void this.renderFollowing(() => this.settleCompactionMarker(state, data));
        break;
      }
      case SSE_EVENT.TOKEN: {
        revealContent();
        if (!state.answerStarted) {
          state.answerStarted = true;
          state.reasoningDetailsEl?.removeAttribute("open");
        }
        state.fullContent += extractString(event.data, "token");
        scheduleRender();
        break;
      }
      case SSE_EVENT.REASONING: {
        revealContent();
        const el = this.ensureReasoningBlock(assistantBubble, textEl, state);
        state.reasoningContent += extractString(event.data, "token");
        this.scheduleReasoningRender(state, el);
        break;
      }
      case SSE_EVENT.SOURCES:
        state.sources.push(...event.data);
        break;
      case SSE_EVENT.DONE: {
        revealContent();
        state.streamEnded = true;
        const rendered = state.fullContent;
        void this.renderFollowing(async () => {
          if (state.reasoningContent) {
            const el = this.ensureReasoningBlock(assistantBubble, textEl, state);
            await this.renderMarkdown(el, state.reasoningContent);
            state.reasoningDetailsEl?.removeAttribute("open");
          }
          this.renderBannerIfPresent(event.data, assistantBubble);
          await this.renderMarkdown(textEl, rendered);
          if (state.sources.length > 0) this.renderSources(assistantBubble, state.sources);
        });
        this.history.push({ role: "assistant", content: rendered });
        if (rendered) {
          const paths = [...new Set(state.sources.map((s) => s.source))];
          this.queuePersist(() => this.persistTurn(this.sessionId, SESSION_ROLE.ASSISTANT, rendered, paths));
        }
        break;
      }
      case SSE_EVENT.ERROR: {
        state.streamEnded = true;
        const errMsg = extractString(event.data, "message");
        assistantBubble.empty();
        assistantBubble.removeClass("assistant");
        assistantBubble.addClass("lilbee-chat-message-error");
        assistantBubble.setAttribute("role", "alert");
        assistantBubble.createDiv({
          cls: "lilbee-chat-error-text",
          text: MESSAGES.ERROR_STREAM(errMsg)
        });
        new import_obsidian20.Notice(MESSAGES.ERROR_STREAM(errMsg));
        if (isModelUnavailableError(extractSseErrorCode(event.data), errMsg)) {
          new import_obsidian20.Notice(MESSAGES.NOTICE_MODEL_UNAVAILABLE_SETUP);
          new SetupWizard(this.app, this.plugin).open();
        }
        break;
      }
      case SSE_EVENT.MEMORY_EXTRACTED: {
        const extracted = event.data;
        if (extracted.count > 0) {
          new import_obsidian20.Notice(MESSAGES.MEMORY_EXTRACTED_NOTICE(extracted.count));
          this.plugin.refreshMemoryViews();
        }
        break;
      }
    }
  }
  /** Create the reasoning block above the answer on first use; return its content div. */
  ensureReasoningBlock(assistantBubble, textEl, state) {
    if (state.reasoningContentEl) return state.reasoningContentEl;
    const details = assistantBubble.createEl("details", { cls: "lilbee-reasoning" });
    if (!state.answerStarted) details.setAttribute("open", "");
    details.createEl("summary", { text: MESSAGES.LABEL_REASONING });
    const content = details.createDiv({ cls: "lilbee-reasoning-content" });
    assistantBubble.insertBefore(details, textEl);
    state.reasoningDetailsEl = details;
    state.reasoningContentEl = content;
    return content;
  }
  /** Coalesce live reasoning re-renders to one per frame. */
  scheduleReasoningRender(state, el) {
    if (state.reasoningRenderPending) return;
    state.reasoningRenderPending = true;
    window.requestAnimationFrame(() => {
      state.reasoningRenderPending = false;
      if (state.streamEnded) return;
      void this.renderFollowing(() => el.setText(plainStream(state.reasoningContent)));
    });
  }
  /** True when the message list is scrolled to (or near) the bottom. */
  isNearBottom() {
    const el = this.messagesEl;
    if (!el) return false;
    return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_FOLLOW_THRESHOLD_PX;
  }
  /** Run a DOM-growing render; re-pin the view to the bottom only if it was pinned before. */
  async renderFollowing(run) {
    const follow = this.isNearBottom();
    await run();
    if (follow && this.messagesEl) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }
  async renderMarkdown(el, markdown) {
    el.empty();
    await import_obsidian20.MarkdownRenderer.render(this.app, markdown, el, "", this);
    el.addClass("markdown-rendered");
  }
  renderInlineError(assistantBubble, text) {
    this.history.pop();
    assistantBubble.empty();
    assistantBubble.removeClass("assistant");
    assistantBubble.addClass("lilbee-chat-message-error");
    assistantBubble.setAttribute("role", "alert");
    assistantBubble.createDiv({ cls: "lilbee-chat-error-text", text });
    new import_obsidian20.Notice(text);
  }
  openFilePicker(event) {
    const menu = new import_obsidian20.Menu();
    menu.addItem((item) => {
      item.setTitle(MESSAGES.WIZARD_FILE_PICKER_VAULT).setIcon("vault").onClick(() => {
        new VaultFilePickerModal(this.app, (file) => this.enqueueAddFile(file)).open();
      });
    });
    menu.addItem((item) => {
      item.setTitle(MESSAGES.WIZARD_FILE_PICKER_DISK).setIcon("file-plus").onClick(() => this.openNativeFilePicker(false));
    });
    menu.addItem((item) => {
      item.setTitle(MESSAGES.WIZARD_FOLDER_PICKER_DISK).setIcon("folder-plus").onClick(() => this.openNativeFilePicker(true));
    });
    menu.addItem((item) => {
      item.setTitle(MESSAGES.WIZARD_CRAWL_WEB).setIcon("globe").onClick(() => {
        new CrawlModal(this.app, this.plugin).open();
      });
    });
    this.showMenu(menu, event);
  }
  /** The core "Native menus" appearance setting; unset falls back to the platform default (native on macOS). */
  prefersNativeMenu() {
    const vault = this.app.vault;
    const value = vault.getConfig?.("nativeMenus");
    return typeof value === "boolean" ? value : import_obsidian20.Platform.isMacOS;
  }
  /** Show a menu, native when the vault prefers it; the in-window menu gets capture-phase ESC dismissal. */
  showMenu(menu, event) {
    const useNative = this.prefersNativeMenu();
    menu.setUseNativeMenu(useNative);
    if (!useNative) {
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          menu.hide();
        }
      };
      activeDocument.addEventListener("keydown", onKey, true);
      menu.onHide(() => activeDocument.removeEventListener("keydown", onKey, true));
    }
    const trigger = event.detail === 0 ? event.currentTarget : null;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom });
      return;
    }
    menu.showAtMouseEvent(event);
  }
  openNativeFilePicker(directory) {
    const properties = directory ? ["openDirectory"] : ["openFile", "multiSelections"];
    electronDialog.showOpenDialog({ properties }).then((result) => {
      if (result.canceled || result.filePaths.length === 0) return;
      void this.plugin.addExternalFiles(result.filePaths);
    }).catch(() => {
      new import_obsidian20.Notice(MESSAGES.ERROR_FILE_PICKER);
    });
  }
  enqueueAddFile(file) {
    void this.plugin.addToLilbee(file);
  }
  showEmptyState() {
    if (this.emptyStateEl || !this.messagesEl) return;
    this.emptyStateEl = this.messagesEl.createDiv({ cls: "lilbee-chat-empty-state" });
    this.emptyStateEl.createDiv({ cls: "lilbee-chat-empty-icon", text: "\u{1F52C}" });
    this.emptyStateEl.createDiv({ cls: "lilbee-chat-empty-heading", text: MESSAGES.NOTICE_NO_MODELS_INSTALLED });
    this.emptyStateEl.createEl("p", { text: MESSAGES.NOTICE_NO_MODELS_DESCRIPTION });
    const btn = this.emptyStateEl.createEl("button", { text: MESSAGES.BUTTON_BROWSE_CATALOG, cls: "mod-cta" });
    btn.addEventListener("click", () => {
      new CatalogModal(this.app, this.plugin).open();
    });
  }
  hideEmptyState() {
    if (this.emptyStateEl) {
      this.emptyStateEl.remove();
      this.emptyStateEl = null;
    }
  }
  async saveToVault() {
    if (this.history.length === 0) {
      new import_obsidian20.Notice(MESSAGES.NOTICE_NOTHING_SAVE);
      return;
    }
    const now = /* @__PURE__ */ new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `chat-${stamp}.md`;
    const folder = "lilbee";
    const path = `${folder}/${filename}`;
    const lines = [`# ${MESSAGES.LABEL_CHAT_VIEW} \u2014 ${now.toLocaleDateString()}`, ""];
    for (const msg of this.history) {
      const label = msg.role === "user" ? "User" : "Assistant";
      lines.push(`**${label}**: ${msg.content}`, "");
    }
    const content = lines.join("\n");
    try {
      const vault = this.app.vault;
      const existing = vault.getAbstractFileByPath(folder);
      if (!existing) {
        await vault.createFolder(folder);
      }
      await vault.create(path, content);
      new import_obsidian20.Notice(MESSAGES.NOTICE_SAVED(path));
    } catch {
      new import_obsidian20.Notice(MESSAGES.ERROR_SAVE_CHAT);
    }
  }
  /** The collapsed "Sources" block shared by live and restored answers. Returns the chip container. */
  createSourcesBlock(container) {
    const sourcesEl = container.createDiv({ cls: "lilbee-chat-sources" });
    const details = sourcesEl.createEl("details");
    details.createEl("summary", { text: MESSAGES.LABEL_SOURCES });
    return details.createDiv({ cls: "lilbee-chat-source-chips" });
  }
  renderSources(container, sources) {
    const chipsEl = this.createSourcesBlock(container);
    renderAggregatedSourceChips(chipsEl, sources, this.app, this.plugin.api);
  }
  renderBannerIfPresent(data, assistantBubble) {
    const banner = extractBanner(data);
    if (banner === null || !this.messagesEl) return;
    const bannerEl = this.messagesEl.createDiv({ cls: "lilbee-chat-banner" });
    bannerEl.setText(banner);
    this.messagesEl.insertBefore(bannerEl, assistantBubble);
  }
};
var VaultFilePickerModal = class extends import_obsidian20.FuzzySuggestModal {
  onChoose;
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder(MESSAGES.PLACEHOLDER_PICK_VAULT_FILE);
  }
  getItems() {
    return this.app.vault.getFiles();
  }
  getItemText(item) {
    return item.path;
  }
  onChooseItem(item) {
    this.onChoose(item);
  }
};

// src/views/documents-modal.ts
var import_obsidian21 = require("obsidian");
var PAGE_SIZE3 = 20;
var SCROLL_BOTTOM_THRESHOLD_PX2 = 200;
var DocumentsModal = class extends import_obsidian21.Modal {
  plugin;
  offset = 0;
  total = 0;
  hasMore = true;
  isFetching = false;
  documents = [];
  selected = /* @__PURE__ */ new Set();
  resultsEl = null;
  removeBtn = null;
  searchQuery = "";
  debouncedSearch;
  cancelDebouncedSearch;
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    const searchDebounced = debounce(() => this.resetAndFetch(), DEBOUNCE_MS);
    this.debouncedSearch = searchDebounced.run;
    this.cancelDebouncedSearch = searchDebounced.cancel;
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-documents-modal");
    contentEl.createEl("h2", { text: MESSAGES.TITLE_DOCUMENTS });
    const searchInput = contentEl.createEl("input", {
      cls: "lilbee-documents-search",
      placeholder: MESSAGES.PLACEHOLDER_SEARCH_DOCUMENTS,
      attr: { type: "text" }
    });
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.debouncedSearch();
    });
    this.removeBtn = contentEl.createEl("button", {
      text: MESSAGES.BUTTON_DELETE_SELECTED,
      cls: "lilbee-documents-remove"
    });
    this.removeBtn.disabled = true;
    this.removeBtn.addEventListener("click", () => void this.removeSelected());
    this.resultsEl = contentEl.createDiv({ cls: "lilbee-documents-results" });
    this.resultsEl.addEventListener("scroll", this.onScroll);
    this.resetAndFetch();
  }
  onClose() {
    this.cancelDebouncedSearch();
    this.resultsEl?.removeEventListener("scroll", this.onScroll);
  }
  onScroll = () => {
    if (!this.resultsEl || this.isFetching || !this.hasMore) return;
    const { scrollTop, clientHeight, scrollHeight } = this.resultsEl;
    if (scrollTop + clientHeight >= scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX2) {
      void this.fetchPage();
    }
  };
  resetAndFetch() {
    this.offset = 0;
    this.hasMore = true;
    this.documents = [];
    this.selected.clear();
    if (this.resultsEl) this.resultsEl.empty();
    this.updateRemoveBtn();
    void this.fetchPage();
  }
  async fetchPage() {
    if (this.isFetching) return;
    this.isFetching = true;
    try {
      const response = await this.plugin.api.listDocuments(
        this.searchQuery || void 0,
        PAGE_SIZE3,
        this.offset
      );
      this.total = response.total;
      this.documents.push(...response.documents);
      this.offset += response.documents.length;
      this.hasMore = response.has_more;
      for (const doc of response.documents) {
        this.renderRow(doc);
      }
    } catch {
      new import_obsidian21.Notice(MESSAGES.ERROR_LOAD_DOCUMENTS);
    } finally {
      this.isFetching = false;
    }
  }
  updateRemoveBtn() {
    if (!this.removeBtn) return;
    this.removeBtn.disabled = this.selected.size === 0;
  }
  renderRow(doc) {
    if (!this.resultsEl) return;
    const row = this.resultsEl.createDiv({ cls: "lilbee-documents-row" });
    const checkbox = row.createEl("input", {
      cls: "lilbee-documents-checkbox",
      attr: { type: "checkbox" }
    });
    checkbox.addEventListener("change", () => {
      const checked = checkbox.checked;
      if (checked) {
        this.selected.add(doc.filename);
      } else {
        this.selected.delete(doc.filename);
      }
      this.updateRemoveBtn();
    });
    const nameEl = row.createDiv({ cls: "lilbee-documents-row-name", text: doc.filename });
    nameEl.setAttribute("title", doc.filename);
    row.createDiv({ cls: "lilbee-documents-row-chunks", text: `${doc.chunk_count} chunks` });
    const dateEl = row.createDiv({ cls: "lilbee-documents-row-date", text: relativeTimeFromIso(doc.ingested_at) });
    if (doc.ingested_at) dateEl.setAttribute("title", doc.ingested_at);
  }
  async removeSelected() {
    if (this.selected.size === 0) return;
    const names = Array.from(this.selected);
    const confirm = new ConfirmModal(this.app, MESSAGES.NOTICE_CONFIRM_DELETE_DOCS(names.length));
    confirm.open();
    const confirmed = await confirm.result;
    if (!confirmed) return;
    try {
      const result = await this.plugin.api.removeDocuments(names, true);
      new import_obsidian21.Notice(MESSAGES.NOTICE_DELETED(result.removed));
      this.resetAndFetch();
    } catch {
      new import_obsidian21.Notice(MESSAGES.ERROR_DELETE_DOCUMENTS);
    }
  }
};

// src/views/search-modal.ts
var import_obsidian22 = require("obsidian");
var SearchModal = class extends import_obsidian22.Modal {
  plugin;
  debouncedSearch;
  resultsContainer = null;
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    const debounced = debounce(() => {
      if (this.lastSearchQuery) {
        void this.runSearch(this.lastSearchQuery);
      }
    }, DEBOUNCE_MS);
    this.debouncedSearch = debounced.run;
    this.cancelDebouncedSearch = debounced.cancel;
    this.lastSearchQuery = "";
    bindEscapeToClose(this);
  }
  lastSearchQuery = "";
  cancelDebouncedSearch;
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-modal");
    contentEl.createEl("h2", { text: MESSAGES.TITLE_SEARCH });
    const input = contentEl.createEl("input", {
      type: "text",
      cls: "lilbee-search-input",
      placeholder: MESSAGES.PLACEHOLDER_TYPE_SEARCH
    });
    this.renderSearchModeToggle(contentEl);
    this.resultsContainer = contentEl.createDiv({ cls: "lilbee-modal-results" });
    this.renderEmptyState(MESSAGES.LABEL_ENTER_QUERY);
    input.addEventListener("input", () => {
      this.lastSearchQuery = input.value.trim();
      this.debouncedSearch();
    });
    window.setTimeout(() => input.focus(), 0);
  }
  onClose() {
    this.cancelDebouncedSearch();
    const { contentEl } = this;
    contentEl.empty();
  }
  renderSearchModeToggle(container) {
    const wikiEnabled = this.plugin.settings.wikiEnabled;
    if (!wikiEnabled && this.plugin.settings.searchChunkType === SEARCH_CHUNK_TYPE.WIKI) {
      this.plugin.settings.searchChunkType = SEARCH_CHUNK_TYPE.ALL;
    }
    if (!wikiEnabled) return;
    const modes = [
      { value: "all", label: MESSAGES.LABEL_SEARCH_ALL },
      { value: "wiki", label: MESSAGES.LABEL_SEARCH_WIKI },
      { value: "raw", label: MESSAGES.LABEL_SEARCH_RAW }
    ];
    const group = container.createDiv({ cls: "lilbee-search-mode" });
    for (const mode of modes) {
      const btn = group.createEl("button", {
        text: mode.label,
        cls: `lilbee-search-mode-btn${this.plugin.settings.searchChunkType === mode.value ? " active" : ""}`
      });
      btn.addEventListener("click", () => {
        this.plugin.settings.searchChunkType = mode.value;
        void this.plugin.saveSettings();
        group.querySelectorAll(".lilbee-search-mode-btn").forEach((b) => b.removeClass("active"));
        btn.addClass("active");
        if (this.lastSearchQuery) this.debouncedSearch();
      });
    }
  }
  renderEmptyState(message) {
    if (!this.resultsContainer) return;
    this.resultsContainer.empty();
    this.resultsContainer.createEl("p", {
      text: message,
      cls: "lilbee-empty-state"
    });
  }
  renderLoading() {
    if (!this.resultsContainer) return;
    this.resultsContainer.empty();
    this.resultsContainer.createDiv({ cls: "lilbee-loading" });
  }
  async runSearch(query) {
    if (!query) {
      this.renderEmptyState(MESSAGES.LABEL_ENTER_QUERY);
      return;
    }
    this.renderLoading();
    try {
      const results = await this.plugin.api.search(
        query,
        this.plugin.settings.topK,
        this.plugin.settings.searchChunkType
      );
      if (!this.resultsContainer) return;
      this.resultsContainer.empty();
      if (results.length === 0) {
        this.renderEmptyState(MESSAGES.LABEL_NO_RESULTS);
        return;
      }
      for (const result of results) {
        renderDocumentResult(this.resultsContainer, result, this.app, this.plugin.api);
      }
    } catch {
      new import_obsidian22.Notice(MESSAGES.ERROR_COULD_NOT_CONNECT);
      this.renderEmptyState(MESSAGES.ERROR_SEARCH_CONNECT);
    }
  }
};

// src/views/task-center.ts
var import_obsidian23 = require("obsidian");

// src/task-queue.ts
var RATE_SAMPLE_FLOOR_MS = 500;
var FLASH_WINDOW_MS = 2e3;
var TaskQueue = class _TaskQueue {
  tasks = /* @__PURE__ */ new Map();
  queues = /* @__PURE__ */ new Map();
  activeIds = /* @__PURE__ */ new Map();
  aborts = /* @__PURE__ */ new Map();
  history = [];
  listeners = [];
  flashTimers = /* @__PURE__ */ new Set();
  static MAX_HISTORY = 50;
  /** Clear pending flash-clear timers — call from plugin unload to avoid zombie notifies. */
  dispose() {
    for (const handle of this.flashTimers) window.clearTimeout(handle);
    this.flashTimers.clear();
  }
  registerAbort(id, controller) {
    const task = this.tasks.get(id);
    if (!task) return;
    this.aborts.set(id, controller);
    task.canCancel = true;
    this.notify();
  }
  onChange(listener) {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }
  notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
  typeQueue(type) {
    let q = this.queues.get(type);
    if (!q) {
      q = [];
      this.queues.set(type, q);
    }
    return q;
  }
  enqueue(name, type, retry) {
    if (this.typeQueue(type).length >= TASK_QUEUE.MAX_QUEUED_PER_TYPE) {
      return null;
    }
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const task = {
      id,
      name,
      type,
      status: TASK_STATUS.QUEUED,
      progress: 0,
      detail: "",
      startedAt: Date.now(),
      completedAt: null,
      error: null,
      canCancel: true,
      retry
    };
    this.tasks.set(id, task);
    this.typeQueue(type).push(id);
    this.processType(type);
    return id;
  }
  backgroundActiveCount() {
    let count = 0;
    for (const [type, id] of this.activeIds) {
      if (id && BACKGROUND_TASK_TYPES.has(type)) count++;
    }
    return count;
  }
  processType(type) {
    if (this.activeIds.get(type)) return;
    const q = this.queues.get(type);
    if (!q || q.length === 0) return;
    if (BACKGROUND_TASK_TYPES.has(type) && this.backgroundActiveCount() >= TASK_QUEUE.MAX_CONCURRENT_BACKGROUND) {
      return;
    }
    const nextId = q.shift();
    this.activate(nextId);
  }
  processAll() {
    for (const type of this.queues.keys()) {
      this.processType(type);
    }
  }
  activate(id) {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status !== TASK_STATUS.QUEUED) return;
    task.status = TASK_STATUS.ACTIVE;
    task.canCancel = this.aborts.has(id);
    this.activeIds.set(task.type, id);
    this.notify();
  }
  update(id, progress, detail, bytes) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.progress = progress;
    if (detail !== void 0) task.detail = detail;
    if (bytes) {
      if (bytes.total !== void 0) task.bytesTotal = bytes.total;
      if (bytes.current !== void 0) {
        const now = Date.now();
        const prevBytes = task.bytesCurrent;
        const prevAt = task.lastRateAt;
        task.bytesCurrent = bytes.current;
        if (prevBytes !== void 0 && prevAt !== void 0) {
          const elapsedMs = now - prevAt;
          if (elapsedMs >= RATE_SAMPLE_FLOOR_MS) {
            const deltaBytes = bytes.current - prevBytes;
            const rate = deltaBytes / elapsedMs * 1e3;
            task.rateBps = rate > 0 ? rate : 0;
            task.lastRateAt = now;
          }
        } else {
          task.lastRateAt = now;
        }
      }
    }
    this.notify();
  }
  complete(id) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = TASK_STATUS.DONE;
    task.progress = 100;
    task.completedAt = Date.now();
    this.moveToHistory(id);
  }
  fail(id, error) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = TASK_STATUS.FAILED;
    task.error = error ?? null;
    task.completedAt = Date.now();
    this.moveToHistory(id);
  }
  /**
   * Neutral terminal state: the server told us it is already handling this work
   * (e.g. a concurrent /api/add for the same source). The task isn't done — the
   * original request is still running — and it isn't failed either, so Retry
   * would just collide again. Park it in history with a `waiting` status and
   * no retry affordance.
   */
  markWaiting(id, detail) {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = TASK_STATUS.WAITING;
    if (detail !== void 0) task.detail = detail;
    task.completedAt = Date.now();
    task.retry = void 0;
    this.moveToHistory(id);
  }
  cancel(id) {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === TASK_STATUS.QUEUED) {
      const q = this.queues.get(task.type);
      if (q) {
        const idx = q.indexOf(id);
        if (idx >= 0) q.splice(idx, 1);
      }
      this.tasks.delete(id);
      this.aborts.delete(id);
      this.notify();
      return;
    }
    if (task.status === TASK_STATUS.ACTIVE) {
      this.aborts.get(id)?.abort();
      task.status = TASK_STATUS.CANCELLED;
      task.completedAt = Date.now();
      this.moveToHistory(id);
    }
  }
  moveToHistory(id) {
    const task = this.tasks.get(id);
    if (this.activeIds.get(task.type) === id) {
      this.activeIds.set(task.type, null);
    }
    this.aborts.delete(id);
    this.history.unshift(task);
    if (this.history.length > _TaskQueue.MAX_HISTORY) {
      this.history.pop();
    }
    this.tasks.delete(id);
    this.notify();
    this.scheduleFlashClear();
    this.processAll();
  }
  scheduleFlashClear() {
    const handle = window.setTimeout(() => {
      this.flashTimers.delete(handle);
      this.notify();
    }, FLASH_WINDOW_MS);
    this.flashTimers.add(handle);
  }
  get active() {
    for (const id of this.activeIds.values()) {
      if (id) {
        const task = this.tasks.get(id);
        if (task) return task;
      }
    }
    return null;
  }
  /** Returns all currently active tasks across all types. */
  /** Returns true if a task of the given type is active or queued. */
  hasPending(type) {
    if (this.activeIds.get(type)) return true;
    const q = this.queues.get(type);
    return q !== void 0 && q.length > 0;
  }
  get activeAll() {
    const result = [];
    for (const id of this.activeIds.values()) {
      if (id) {
        const task = this.tasks.get(id);
        if (task) result.push(task);
      }
    }
    return result;
  }
  get queued() {
    const result = [];
    for (const q of this.queues.values()) {
      for (const id of q) {
        const task = this.tasks.get(id);
        if (task) result.push(task);
      }
    }
    return result;
  }
  get completed() {
    return [...this.history];
  }
  clearHistory() {
    this.history = [];
    this.notify();
  }
  toJSON() {
    return { history: [...this.history] };
  }
  loadFromJSON(data) {
    if (!data || !Array.isArray(data.history)) return;
    this.history = data.history.slice(0, _TaskQueue.MAX_HISTORY);
    this.notify();
  }
};

// src/views/task-center.ts
var ACTIVE_PCT_CAP = 99;
var VIEW_TYPE_TASKS = "lilbee-tasks";
var ACTIVE_REFRESH_INTERVAL_MS = 1e3;
var TaskCenterView = class extends import_obsidian23.ItemView {
  plugin;
  unsubscribe = null;
  countersEl = null;
  capPill = null;
  activeSection = null;
  queuedSection = null;
  completedSection = null;
  refreshInterval = null;
  refreshIntervalMs = TIME_REFRESH_INTERVAL_MS;
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_TASKS;
  }
  getDisplayText() {
    return MESSAGES.LABEL_TASKS_VIEW;
  }
  getIcon() {
    return "list-checks";
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-tasks-container");
    const header = contentEl.createDiv({ cls: "lilbee-tasks-header" });
    header.createEl("h2", { text: MESSAGES.LABEL_TASK_CENTER });
    this.countersEl = header.createSpan({ cls: "lilbee-tasks-counters" });
    this.capPill = header.createSpan({ cls: "lilbee-tasks-cap-pill" });
    this.capPill.hide();
    const clearBtn = header.createEl("button", { cls: "lilbee-tasks-clear" });
    clearBtn.setText(MESSAGES.BUTTON_CLEAR_TASKS);
    clearBtn.addEventListener("click", () => {
      this.plugin.taskQueue.clearHistory();
      this.render();
    });
    this.activeSection = contentEl.createDiv({ cls: "lilbee-tasks-section" });
    this.activeSection.createDiv({ cls: "lilbee-tasks-section-header" }).setText(MESSAGES.LABEL_ACTIVE_TASKS);
    this.queuedSection = contentEl.createDiv({ cls: "lilbee-tasks-section" });
    this.queuedSection.createDiv({ cls: "lilbee-tasks-section-header" }).setText(MESSAGES.LABEL_QUEUED_TASKS);
    this.completedSection = contentEl.createDiv({ cls: "lilbee-tasks-section" });
    this.completedSection.createDiv({ cls: "lilbee-tasks-section-header" }).textContent = MESSAGES.LABEL_COMPLETED_TASKS;
    this.unsubscribe = this.plugin.taskQueue.onChange(() => this.render());
    this.retuneRefreshInterval();
    this.render();
  }
  async onClose() {
    this.unsubscribe?.();
    if (this.refreshInterval !== null) {
      window.clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
  render() {
    if (!this.activeSection || !this.queuedSection || !this.completedSection) return;
    this.renderCounters();
    this.renderCapPill();
    this.renderActive();
    this.renderQueued();
    this.renderCompleted();
    this.retuneRefreshInterval();
  }
  retuneRefreshInterval() {
    const hasActive = this.plugin.taskQueue.activeAll.length > 0;
    const targetMs = hasActive ? ACTIVE_REFRESH_INTERVAL_MS : TIME_REFRESH_INTERVAL_MS;
    if (targetMs === this.refreshIntervalMs && this.refreshInterval !== null) return;
    if (this.refreshInterval !== null) {
      window.clearInterval(this.refreshInterval);
    }
    this.refreshIntervalMs = targetMs;
    this.refreshInterval = window.setInterval(() => this.render(), targetMs);
  }
  renderCounters() {
    if (!this.countersEl) return;
    const active = this.plugin.taskQueue.activeAll.length;
    const queued = this.plugin.taskQueue.queued.length;
    const done = this.plugin.taskQueue.completed.length;
    this.countersEl.setText(
      MESSAGES.LABEL_TASK_COUNTERS.replace("{active}", String(active)).replace("{queued}", String(queued)).replace("{done}", String(done))
    );
  }
  renderCapPill() {
    if (!this.capPill) return;
    const backgroundActive = this.plugin.taskQueue.activeAll.filter(
      (t) => BACKGROUND_TASK_TYPES.has(t.type)
    ).length;
    const cap = TASK_QUEUE.MAX_CONCURRENT_BACKGROUND;
    if (backgroundActive >= cap) {
      this.capPill.setText(
        MESSAGES.LABEL_TASK_CAP_PILL.replace("{active}", String(backgroundActive)).replace(
          "{cap}",
          String(cap)
        )
      );
      this.capPill.show();
    } else {
      this.capPill.setText("");
      this.capPill.hide();
    }
  }
  renderActive() {
    if (!this.activeSection) return;
    const container = this.activeSection;
    container.querySelectorAll(".lilbee-task-row").forEach((el) => el.remove());
    container.querySelectorAll(".lilbee-tasks-empty").forEach((el) => el.remove());
    const allActive = this.plugin.taskQueue.activeAll;
    if (allActive.length === 0) {
      const empty = container.createDiv({ cls: "lilbee-tasks-empty" });
      empty.setText(MESSAGES.LABEL_NO_ACTIVE_TASKS);
      return;
    }
    for (const task of allActive) {
      this.renderTaskRow(container, task, TASK_STATUS.ACTIVE);
    }
  }
  renderQueued() {
    if (!this.queuedSection) return;
    const container = this.queuedSection;
    container.querySelectorAll(".lilbee-task-row").forEach((el) => el.remove());
    container.querySelectorAll(".lilbee-tasks-empty").forEach((el) => el.remove());
    const queued = this.plugin.taskQueue.queued;
    if (queued.length === 0) {
      const empty = container.createDiv({ cls: "lilbee-tasks-empty" });
      empty.setText(MESSAGES.LABEL_NO_QUEUED_TASKS);
      return;
    }
    for (const task of queued) {
      this.renderTaskRow(container, task, TASK_STATUS.QUEUED);
    }
  }
  renderCompleted() {
    if (!this.completedSection) return;
    const container = this.completedSection;
    container.querySelectorAll(".lilbee-task-row").forEach((el) => el.remove());
    container.querySelectorAll(".lilbee-tasks-empty").forEach((el) => el.remove());
    const completed = this.plugin.taskQueue.completed;
    if (completed.length === 0) {
      const empty = container.createDiv({ cls: "lilbee-tasks-empty" });
      empty.setText(MESSAGES.LABEL_NO_COMPLETED_TASKS);
      return;
    }
    for (const task of completed) {
      this.renderTaskRow(container, task, task.status);
    }
  }
  renderTaskRow(container, task, state) {
    const row = container.createDiv({ cls: "lilbee-task-row" });
    row.dataset.state = state;
    row.dataset.type = task.type;
    const isActive = state === TASK_STATUS.ACTIVE;
    const isTerminal = state === TASK_STATUS.DONE || state === TASK_STATUS.FAILED || state === TASK_STATUS.CANCELLED || state === TASK_STATUS.WAITING;
    const isIndeterminate = isActive && task.progress <= INDETERMINATE_PROGRESS;
    const rawPct = Math.max(0, Math.min(100, task.progress));
    const pct = isIndeterminate ? 100 : isActive ? Math.min(rawPct, ACTIVE_PCT_CAP) : rawPct;
    if (isTerminal && isWithinFlashWindow(task)) {
      row.addClass("lilbee-task-flash");
    }
    row.createDiv({ cls: "lilbee-task-rail" });
    const body = row.createDiv({ cls: "lilbee-task-body" });
    const head = body.createDiv({ cls: "lilbee-task-head" });
    const typeBadge = head.createSpan({ cls: `lilbee-task-type-badge lilbee-task-badge-${task.type}` });
    typeBadge.setText(task.type.toUpperCase());
    head.createSpan({ cls: "lilbee-task-name", text: task.name });
    const meta = head.createSpan({ cls: "lilbee-task-meta" });
    meta.setText(metaForRow(task, state));
    const stats = body.createDiv({ cls: "lilbee-task-stats" });
    const statsLabel = stats.createSpan({ cls: "lilbee-task-stats-label" });
    statsLabel.setText(statsLine(task, state));
    const pctLabel = stats.createSpan({ cls: "lilbee-task-pct" });
    pctLabel.setText(isIndeterminate || !isActive ? "" : `${Math.round(pct)}%`);
    const barContainer = body.createDiv({ cls: "lilbee-task-progress-bar" });
    const barFill = barContainer.createDiv({ cls: "lilbee-task-progress-fill" });
    barFill.style.width = `${pct}%`;
    if (isIndeterminate) barFill.classList.add("lilbee-task-progress-indeterminate");
    if (isActive && task.canCancel) {
      const cancelBtn = row.createEl("button", { cls: "lilbee-task-cancel" });
      cancelBtn.setText(MESSAGES.LABEL_CLOSE_GLYPH);
      cancelBtn.title = MESSAGES.LABEL_CANCEL_TASK;
      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.handleCancel(task);
      });
    }
    if ((state === TASK_STATUS.FAILED || state === TASK_STATUS.CANCELLED) && task.retry) {
      const retryBtn = row.createEl("button", { cls: "lilbee-task-retry" });
      retryBtn.setText(MESSAGES.LABEL_RETRY_TASK);
      retryBtn.title = MESSAGES.LABEL_RETRY_TASK;
      retryBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void task.retry?.();
      });
    }
    if (task.error && state === TASK_STATUS.FAILED) {
      row.title = task.error;
    }
  }
  async handleCancel(task) {
    if (task.canCancel) {
      this.plugin.taskQueue.cancel(task.id);
      return;
    }
    const modal = new ConfirmModal(this.plugin.app, MESSAGES.NOTICE_CONFIRM_CANCEL);
    modal.open();
    const confirmed = await modal.result;
    if (confirmed) {
      this.plugin.taskQueue.cancel(task.id);
    }
  }
};
function metaForRow(task, state) {
  if (state === TASK_STATUS.ACTIVE) {
    return formatElapsed(Date.now() - task.startedAt);
  }
  if (state === TASK_STATUS.QUEUED) {
    return MESSAGES.LABEL_TASK_STATE_QUEUED;
  }
  if (state === TASK_STATUS.DONE) {
    return task.completedAt !== null ? relativeTime(task.completedAt) : MESSAGES.LABEL_TASK_STATE_DONE;
  }
  if (state === TASK_STATUS.FAILED) {
    return task.completedAt !== null ? relativeTime(task.completedAt) : MESSAGES.LABEL_TASK_STATE_FAILED;
  }
  if (state === TASK_STATUS.WAITING) {
    return task.completedAt !== null ? relativeTime(task.completedAt) : MESSAGES.LABEL_TASK_STATE_WAITING;
  }
  return task.completedAt !== null ? relativeTime(task.completedAt) : MESSAGES.LABEL_TASK_STATE_CANCELLED;
}
function statsLine(task, state) {
  if (state !== TASK_STATUS.ACTIVE) {
    if (task.detail) return task.detail;
    if (task.error) return task.error;
    return "";
  }
  const parts = [];
  if (task.bytesTotal && task.bytesCurrent !== void 0) {
    parts.push(`${formatBytes(task.bytesCurrent)} / ${formatBytes(task.bytesTotal)}`);
  } else if (task.bytesCurrent !== void 0) {
    parts.push(formatBytes(task.bytesCurrent));
  }
  if (task.rateBps && task.rateBps > 0) {
    parts.push(formatRate(task.rateBps));
  }
  if (parts.length === 0 && task.detail) return task.detail;
  return parts.join(" \u2014 ");
}
function isWithinFlashWindow(task) {
  if (task.completedAt === null) return false;
  return Date.now() - task.completedAt < FLASH_WINDOW_MS;
}

// src/views/wiki-view.ts
var import_obsidian25 = require("obsidian");

// src/views/citation-modal.ts
var import_obsidian24 = require("obsidian");
var CitationModal = class extends import_obsidian24.Modal {
  plugin;
  slug;
  constructor(app, plugin, slug) {
    super(app);
    this.plugin = plugin;
    this.slug = slug;
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-modal");
    contentEl.createEl("h2", { text: MESSAGES.TITLE_CITATIONS });
    const loading = contentEl.createDiv({ cls: "lilbee-loading" });
    void this.loadCitations(contentEl, loading);
  }
  onClose() {
    this.contentEl.empty();
  }
  async loadCitations(contentEl, loading) {
    try {
      const chain = await this.plugin.api.wikiCitations(this.slug);
      loading.remove();
      this.renderChain(contentEl, chain);
    } catch {
      loading.remove();
      contentEl.createEl("p", {
        text: MESSAGES.ERROR_LOAD_CITATIONS,
        cls: "lilbee-empty-state"
      });
    }
  }
  renderChain(container, chain) {
    const header = container.createDiv({ cls: "lilbee-wiki-meta" });
    header.createEl("strong", { text: chain.wiki_page });
    if (chain.citations.length === 0) {
      container.createEl("p", {
        text: MESSAGES.LABEL_NO_CITATIONS,
        cls: "lilbee-empty-state"
      });
      return;
    }
    for (const citation of chain.citations) {
      this.renderCitation(container, citation);
    }
  }
  renderCitation(container, citation) {
    const card = container.createDiv({ cls: "lilbee-citation-card" });
    const header = card.createDiv({ cls: "lilbee-document-card-header" });
    header.createSpan({
      text: citation.citation_key,
      cls: "lilbee-citation-key"
    });
    header.createSpan({
      text: citation.claim_type === CLAIM_TYPE.FACT ? MESSAGES.LABEL_CITATION_FACT : MESSAGES.LABEL_CITATION_INFERENCE,
      cls: `lilbee-citation-claim-badge lilbee-claim-${citation.claim_type}`
    });
    const sourceLink = card.createEl("a", {
      text: citation.source_filename,
      cls: "lilbee-document-source"
    });
    sourceLink.addEventListener("click", (e) => {
      e.preventDefault();
      const source = {
        source: citation.source_filename,
        content_type: "",
        distance: 0,
        chunk: citation.excerpt,
        page_start: citation.page_start,
        page_end: citation.page_end,
        line_start: citation.line_start,
        line_end: citation.line_end
      };
      void executeSourceClick(this.app, this.plugin.api, sourceClickAction(source, this.app.vault));
    });
    const loc = formatLocation(citation);
    if (loc) {
      card.createSpan({ text: loc, cls: "lilbee-location" });
    }
    if (citation.excerpt) {
      card.createEl("blockquote", {
        text: citation.excerpt,
        cls: "lilbee-citation-excerpt"
      });
    }
    card.createSpan({
      text: citation.source_hash ? MESSAGES.LABEL_CITATION_CURRENT : MESSAGES.LABEL_CITATION_STALE,
      cls: `lilbee-citation-hash-status ${citation.source_hash ? "lilbee-hash-current" : "lilbee-hash-stale"}`
    });
  }
};

// src/views/wiki-view.ts
var VIEW_TYPE_WIKI = "lilbee-wiki";
var NOTICE_DURATION_MS3 = 4e3;
var PAGE_RETRY_DELAY_MS = 900;
function stubName(stub) {
  return stub.label || stub.slug;
}
var WikiView = class extends import_obsidian25.ItemView {
  plugin;
  pages = [];
  stubs = [];
  generating = null;
  selectedSlug = null;
  listEl = null;
  detailEl = null;
  filterInput = null;
  /** Which detail render is current; older overlapping renders drop out. */
  renderSeq = 0;
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_WIKI;
  }
  getDisplayText() {
    return MESSAGES.LABEL_WIKI_VIEW;
  }
  getIcon() {
    return "book-open";
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-wiki-container");
    const header = contentEl.createDiv({ cls: "lilbee-wiki-header" });
    header.createEl("h2", { text: MESSAGES.LABEL_WIKI });
    const actions = header.createDiv({ cls: "lilbee-toolbar-group" });
    const refreshBtn = actions.createEl("button", { cls: "lilbee-tasks-clear" });
    (0, import_obsidian25.setIcon)(refreshBtn, "refresh-cw");
    refreshBtn.setAttribute("aria-label", MESSAGES.BUTTON_REFRESH);
    refreshBtn.addEventListener("click", () => void this.refresh());
    const lintBtn = actions.createEl("button", { cls: "lilbee-tasks-clear" });
    (0, import_obsidian25.setIcon)(lintBtn, "check-circle");
    lintBtn.setAttribute("aria-label", MESSAGES.LABEL_WIKI_RUN_LINT);
    lintBtn.addEventListener("click", () => {
      void this.plugin.runWikiLint();
    });
    this.filterInput = contentEl.createEl("input", {
      type: "text",
      cls: "lilbee-wiki-search",
      placeholder: MESSAGES.PLACEHOLDER_TYPE_SEARCH
    });
    this.filterInput.addEventListener("input", () => this.renderList());
    this.listEl = contentEl.createDiv({ cls: "lilbee-wiki-list" });
    this.detailEl = contentEl.createDiv({ cls: "lilbee-wiki-detail" });
    void this.refresh();
  }
  async refresh() {
    try {
      this.pages = await this.plugin.api.wikiList();
    } catch {
      this.pages = [];
    }
    try {
      this.stubs = await this.plugin.api.wikiStubs();
    } catch {
      this.stubs = [];
    }
    this.renderList();
    if (this.selectedSlug) {
      void this.showPage(this.selectedSlug);
    }
  }
  renderList() {
    if (!this.listEl) return;
    this.listEl.empty();
    const filter = this.filterInput?.value.toLowerCase() ?? "";
    const filtered = filter ? this.pages.filter((p) => p.title.toLowerCase().includes(filter)) : this.pages;
    const unwritten = filter ? this.stubs.filter((s) => stubName(s).toLowerCase().includes(filter)) : this.stubs;
    if (filtered.length === 0 && unwritten.length === 0) {
      this.listEl.createEl("p", {
        text: MESSAGES.LABEL_WIKI_NO_PAGES,
        cls: "lilbee-empty-state"
      });
      return;
    }
    const summaries = filtered.filter((p) => p.page_type === WIKI_PAGE_TYPE.SUMMARY);
    const concepts = filtered.filter((p) => CONCEPT_ONLY_WIKI_PAGE_TYPES.has(p.page_type));
    const entities = filtered.filter((p) => p.page_type === WIKI_PAGE_TYPE.ENTITY);
    if (summaries.length > 0) {
      this.renderGroup(this.listEl, MESSAGES.LABEL_WIKI_SUMMARIES, summaries);
    }
    if (concepts.length > 0) {
      this.renderGroup(this.listEl, MESSAGES.LABEL_WIKI_CONCEPTS, concepts);
    }
    if (entities.length > 0) {
      this.renderGroup(this.listEl, MESSAGES.LABEL_WIKI_ENTITIES, entities);
    }
    if (unwritten.length > 0) {
      this.listEl.createEl("h3", {
        text: MESSAGES.LABEL_WIKI_UNWRITTEN(unwritten.length),
        cls: "lilbee-tasks-section-header"
      });
      for (const stub of unwritten) this.renderStubItem(this.listEl, stub);
    }
  }
  /**
   * Write one unwritten subject, on request.
   *
   * Confirmed first because it spends a model call on a GPU that may be busy,
   * and the page can take minutes. The list is repainted around the call so
   * the row reads as busy, and the finished page opens itself.
   */
  async generateStub(stub) {
    if (this.generating) return;
    const modal = new ConfirmModal(this.app, MESSAGES.CONFIRM_WIKI_GENERATE(stubName(stub)));
    modal.open();
    if (!await modal.result) return;
    const taskId = this.plugin.taskQueue.enqueue(MESSAGES.TASK_WIKI_GENERATE(stubName(stub)), TASK_TYPE.WIKI);
    if (taskId === null) {
      new import_obsidian25.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    this.plugin.taskQueue.update(taskId, INDETERMINATE_PROGRESS, MESSAGES.LABEL_WIKI_WRITING);
    this.generating = stub.slug;
    this.renderList();
    try {
      let written = null;
      for await (const event of this.plugin.api.wikiGenerate(stub.slug)) {
        if (event.event === SSE_EVENT.ERROR) {
          throw new Error(
            extractSseErrorMessage(event.data, MESSAGES.ERROR_UNKNOWN)
          );
        }
        if (event.event === SSE_EVENT.WIKI_PHASE || event.event === SSE_EVENT.WIKI_PAGE) {
          this.plugin.taskQueue.update(taskId, INDETERMINATE_PROGRESS, MESSAGES.LABEL_WIKI_WRITING);
        }
        if (event.event === SSE_EVENT.DONE) {
          written = event.data;
        }
      }
      if (!written) throw new Error(MESSAGES.ERROR_UNKNOWN);
      this.plugin.taskQueue.complete(taskId);
      new import_obsidian25.Notice(MESSAGES.NOTICE_WIKI_GENERATED(stubName(stub)), NOTICE_DURATION_MS3);
      await this.refresh();
      this.selectedSlug = written.slug;
      this.renderList();
      try {
        await this.plugin.wikiSync?.writePage(this.selectedSlug);
      } catch {
      }
      void this.showPage(this.selectedSlug);
    } catch (err3) {
      this.plugin.taskQueue.fail(taskId, errorMessage(err3, MESSAGES.ERROR_UNKNOWN));
      this.generating = null;
      this.renderList();
      return;
    }
    this.generating = null;
  }
  /**
   * Resolve a `[[wikilink]]` to a page in this wiki.
   *
   * Generated pages link each other by bare subject, `[[jupiter]]`, while a
   * page's slug carries its section, `entities/jupiter`, and its title is
   * capitalised. Comparing the href against slug and title alone therefore
   * matched nothing, and every cross-link fell through to `openLinkText`,
   * which navigated the workspace away from the wiki to a vault note that
   * does not exist. So the advertised cross-linking never worked at all.
   *
   * Matched case-insensitively against the full slug, the slug's last
   * segment, and the title.
   */
  resolveWikiLink(href) {
    const wanted = href.trim().toLowerCase();
    if (!wanted) return void 0;
    return this.pages.find((p) => {
      const slug = p.slug.toLowerCase();
      return slug === wanted || slug.split("/").pop() === wanted || p.title.toLowerCase() === wanted;
    });
  }
  /**
   * A subject the corpus names but nothing has written. Rendered dim and
   * marked, because it is an offer rather than a page: opening it asks
   * whether to spend a model call writing it.
   */
  renderStubItem(container, stub) {
    const busy = this.generating === stub.slug;
    const item = container.createDiv({
      cls: `lilbee-wiki-page-item lilbee-wiki-stub${busy ? " generating" : ""}`
    });
    const info = item.createDiv({ cls: "lilbee-task-info" });
    const badge = info.createSpan({ cls: "lilbee-wiki-type-badge" });
    badge.addClass(`lilbee-wiki-type-${stub.kind}`);
    badge.setText(stub.kind);
    info.createSpan({ cls: "lilbee-task-name", text: stubName(stub) });
    const meta = item.createDiv({ cls: "lilbee-wiki-meta" });
    meta.createSpan({ text: MESSAGES.LABEL_WIKI_SOURCES_COUNT(stub.sources.length) });
    meta.createSpan({
      cls: "lilbee-wiki-stub-hint",
      text: busy ? MESSAGES.LABEL_WIKI_WRITING : MESSAGES.LABEL_WIKI_NOT_WRITTEN
    });
    item.addEventListener("click", () => void this.generateStub(stub));
  }
  renderGroup(container, label, pages) {
    container.createEl("h3", { text: label, cls: "lilbee-tasks-section-header" });
    for (const page of pages) {
      this.renderPageItem(container, page);
    }
  }
  renderPageItem(container, page) {
    const item = container.createDiv({
      cls: `lilbee-wiki-page-item${page.slug === this.selectedSlug ? " active" : ""}`
    });
    const info = item.createDiv({ cls: "lilbee-task-info" });
    const typeBadge = info.createSpan({ cls: "lilbee-wiki-type-badge" });
    typeBadge.addClass(`lilbee-wiki-type-${page.page_type}`);
    typeBadge.setText(page.page_type);
    info.createSpan({ cls: "lilbee-task-name", text: page.title });
    const meta = item.createDiv({ cls: "lilbee-wiki-meta" });
    meta.createSpan({ text: MESSAGES.LABEL_WIKI_SOURCES_COUNT(page.source_count) });
    if (page.created_at) {
      const ts = new Date(page.created_at).getTime();
      meta.createSpan({ text: relativeTime(ts), cls: "lilbee-task-time" });
    }
    item.addEventListener("click", () => {
      this.selectedSlug = page.slug;
      this.renderList();
      void this.showPage(page.slug);
    });
  }
  async showPage(slug) {
    if (!this.detailEl) return;
    const seq = ++this.renderSeq;
    this.detailEl.empty();
    const loading = this.detailEl.createDiv({ cls: "lilbee-loading" });
    try {
      const page = await this.fetchPageWithRetry(slug);
      if (seq !== this.renderSeq) return;
      loading.remove();
      this.renderDetail(page);
    } catch {
      if (seq !== this.renderSeq) return;
      loading.remove();
      this.detailEl.createEl("p", {
        text: MESSAGES.ERROR_LOAD_PAGE,
        cls: "lilbee-empty-state"
      });
    }
  }
  /**
   * Read a page, retrying once after a short pause.
   *
   * A page opened immediately after it was written can miss: the write
   * reports done and the read is briefly not served yet, which surfaced as
   * "Failed to load page" for the page the user had just asked for, while
   * the same request succeeded a moment later.
   */
  async fetchPageWithRetry(slug) {
    try {
      return await this.plugin.api.wikiPage(slug);
    } catch (first) {
      await new Promise((r) => window.setTimeout(r, PAGE_RETRY_DELAY_MS));
      try {
        return await this.plugin.api.wikiPage(slug);
      } catch {
        throw first;
      }
    }
  }
  renderDetail(page) {
    if (!this.detailEl) return;
    const meta = this.detailEl.createDiv({ cls: "lilbee-wiki-meta" });
    meta.createEl("strong", { text: page.title });
    if (page.created_at) {
      meta.createSpan({ text: new Date(page.created_at).toLocaleString() });
    }
    const content = this.detailEl.createDiv({ cls: "lilbee-wiki-content" });
    void import_obsidian25.MarkdownRenderer.render(this.app, page.content, content, "", this);
    content.addEventListener("click", (e) => {
      const target2 = e.target;
      const link = target2.closest("a.internal-link");
      if (link) {
        e.preventDefault();
        const href = link.getAttribute("data-href") ?? link.textContent ?? "";
        const matchingPage = this.resolveWikiLink(href);
        if (matchingPage) {
          this.selectedSlug = matchingPage.slug;
          this.renderList();
          void this.showPage(matchingPage.slug);
        } else {
          void this.app.workspace.openLinkText(href, "");
        }
      }
      const footnoteRef = target2.closest("a[href^='#^src'], a[href^='#fn']");
      if (footnoteRef && this.selectedSlug) {
        e.preventDefault();
        new CitationModal(this.app, this.plugin, this.selectedSlug).open();
      }
    });
  }
};

// src/views/memories-view.ts
var import_obsidian27 = require("obsidian");

// src/views/remember-modal.ts
var import_obsidian26 = require("obsidian");
var RememberModal = class extends import_obsidian26.Modal {
  plugin;
  text = "";
  kind = MEMORY_KIND.FACT;
  shared = false;
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-remember-modal");
    contentEl.createEl("h3", { text: MESSAGES.LABEL_REMEMBER_TITLE });
    contentEl.createEl("label", { text: MESSAGES.LABEL_REMEMBER_TEXT_LABEL, cls: "lilbee-remember-label" });
    const textEl = contentEl.createEl("textarea", { cls: "lilbee-remember-text" });
    textEl.placeholder = MESSAGES.LABEL_REMEMBER_TEXT_PLACEHOLDER;
    textEl.addEventListener("input", () => {
      this.text = textEl.value;
    });
    const kindRow = contentEl.createDiv({ cls: "lilbee-remember-row" });
    kindRow.createEl("label", { text: MESSAGES.LABEL_REMEMBER_KIND_LABEL, cls: "lilbee-remember-label" });
    const kindEl = kindRow.createEl("select", { cls: "lilbee-remember-kind" });
    kindEl.createEl("option", { text: MESSAGES.LABEL_REMEMBER_KIND_FACT, value: MEMORY_KIND.FACT });
    kindEl.createEl("option", { text: MESSAGES.LABEL_REMEMBER_KIND_PREFERENCE, value: MEMORY_KIND.PREFERENCE });
    kindEl.value = MEMORY_KIND.FACT;
    kindEl.addEventListener("change", () => {
      this.kind = kindEl.value === MEMORY_KIND.PREFERENCE ? MEMORY_KIND.PREFERENCE : MEMORY_KIND.FACT;
    });
    const sharedBtn = kindRow.createEl("button", {
      text: MESSAGES.LABEL_REMEMBER_SHARED_LABEL,
      cls: "lilbee-remember-shared"
    });
    sharedBtn.addEventListener("click", () => {
      this.shared = !this.shared;
      sharedBtn.toggleClass("is-active", this.shared);
    });
    const actions = contentEl.createDiv({ cls: "lilbee-remember-actions" });
    const saveBtn = actions.createEl("button", { text: MESSAGES.BUTTON_REMEMBER, cls: "mod-cta" });
    saveBtn.addEventListener("click", () => void this.submit());
    const cancelBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CANCEL });
    cancelBtn.addEventListener("click", () => this.close());
  }
  async submit() {
    const text = this.text.trim();
    if (!text) {
      new import_obsidian26.Notice(MESSAGES.REMEMBER_EMPTY);
      return;
    }
    try {
      await this.plugin.api.remember(text, this.kind, this.shared);
      new import_obsidian26.Notice(MESSAGES.REMEMBER_SUCCESS(this.kind));
      this.plugin.refreshMemoryViews();
      this.close();
    } catch (err3) {
      new import_obsidian26.Notice(
        MESSAGES.REMEMBER_FAILED(errorMessage(err3, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode))
      );
    }
  }
};

// src/views/memories-view.ts
var VIEW_TYPE_MEMORIES = "lilbee-memories";
var MemoriesView = class extends import_obsidian27.ItemView {
  plugin;
  memories = null;
  filter = "";
  listEl = null;
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_MEMORIES;
  }
  getDisplayText() {
    return MESSAGES.LABEL_MEMORIES_VIEW;
  }
  getIcon() {
    return "brain";
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-memories-container");
    const header = contentEl.createDiv({ cls: "lilbee-memories-header" });
    header.createEl("h2", { text: MESSAGES.LABEL_MEMORIES_TITLE });
    const addBtn = header.createEl("button", { text: MESSAGES.BUTTON_ADD_MEMORY, cls: "lilbee-memories-add" });
    addBtn.addEventListener("click", () => new RememberModal(this.app, this.plugin).open());
    const searchEl = contentEl.createEl("input", { cls: "lilbee-memories-search" });
    searchEl.type = "text";
    searchEl.placeholder = MESSAGES.MEMORIES_SEARCH_PLACEHOLDER;
    searchEl.addEventListener("input", () => {
      this.filter = searchEl.value.toLowerCase();
      this.renderList();
    });
    this.listEl = contentEl.createDiv({ cls: "lilbee-memories-list" });
    await this.loadMemories();
  }
  async reload() {
    await this.loadMemories();
  }
  async loadMemories() {
    try {
      const cfg = await this.plugin.api.config();
      if (cfg[MEMORY_CONFIG_KEY.ENABLED] !== true) {
        this.memories = null;
        this.renderMessage(MESSAGES.MEMORIES_DISABLED);
        return;
      }
      this.memories = await this.plugin.api.listMemories();
      this.renderList();
    } catch (err3) {
      this.memories = null;
      this.renderMessage(
        MESSAGES.MEMORIES_LOAD_FAILED(
          errorMessage(err3, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode)
        )
      );
    }
  }
  renderMessage(message) {
    if (!this.listEl) return;
    this.listEl.empty();
    this.listEl.createDiv({ cls: "lilbee-memories-empty", text: message });
  }
  renderList() {
    if (!this.listEl || this.memories === null) return;
    this.listEl.empty();
    const visible = this.memories.filter((m) => m.text.toLowerCase().includes(this.filter));
    if (visible.length === 0) {
      this.listEl.createDiv({ cls: "lilbee-memories-empty", text: MESSAGES.MEMORIES_EMPTY });
      return;
    }
    for (const memory of visible) {
      this.renderRow(this.listEl, memory);
    }
  }
  renderRow(container, memory) {
    const row = container.createDiv({ cls: "lilbee-memory-row" });
    row.dataset.kind = memory.kind;
    row.createSpan({
      cls: `lilbee-memory-kind lilbee-memory-kind-${memory.kind}`,
      text: memory.kind === MEMORY_KIND.PREFERENCE ? MESSAGES.LABEL_REMEMBER_KIND_PREFERENCE : MESSAGES.LABEL_REMEMBER_KIND_FACT
    });
    row.createSpan({ cls: "lilbee-memory-text", text: memory.text });
    const shareBtn = row.createEl("button", {
      cls: "lilbee-memory-share",
      text: memory.shared ? MESSAGES.MEMORIES_FLAG_YES : MESSAGES.MEMORIES_FLAG_NO
    });
    shareBtn.title = MESSAGES.MEMORIES_SHARE_TOOLTIP;
    shareBtn.toggleClass("is-shared", memory.shared);
    shareBtn.addEventListener("click", () => void this.toggleShared(memory));
    const deleteBtn = row.createEl("button", {
      cls: "lilbee-memory-delete",
      text: MESSAGES.LABEL_CLOSE_GLYPH
    });
    deleteBtn.title = MESSAGES.MEMORIES_DELETE_TOOLTIP;
    deleteBtn.addEventListener("click", () => void this.confirmDelete(memory));
  }
  async toggleShared(memory) {
    const next = !memory.shared;
    try {
      await this.plugin.api.setMemoryShared(memory.id, next);
      new import_obsidian27.Notice(next ? MESSAGES.MEMORIES_SHARED_ON : MESSAGES.MEMORIES_SHARED_OFF);
      await this.loadMemories();
    } catch (err3) {
      new import_obsidian27.Notice(
        MESSAGES.MEMORIES_FLAG_FAILED(
          errorMessage(err3, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode)
        )
      );
    }
  }
  async confirmDelete(memory) {
    const modal = new ConfirmModal(this.app, MESSAGES.MEMORIES_DELETE_CONFIRM);
    modal.open();
    const confirmed = await modal.result;
    if (!confirmed) return;
    try {
      await this.plugin.api.forgetMemory(memory.id);
      new import_obsidian27.Notice(MESSAGES.MEMORIES_DELETED);
      await this.loadMemories();
    } catch (err3) {
      new import_obsidian27.Notice(
        MESSAGES.MEMORIES_DELETE_FAILED(
          errorMessage(err3, MESSAGES.ERROR_UNKNOWN, this.plugin.settings.serverMode)
        )
      );
    }
  }
};

// src/views/lint-modal.ts
var import_obsidian28 = require("obsidian");
var STATUS_CLASSES = {
  valid: "lilbee-lint-valid",
  stale_hash: "lilbee-lint-stale",
  source_deleted: "lilbee-lint-deleted",
  excerpt_missing: "lilbee-lint-missing",
  model_changed: "lilbee-lint-model"
};
var STATUS_LABELS = {
  valid: MESSAGES.LABEL_LINT_STATUS_VALID,
  stale_hash: MESSAGES.LABEL_LINT_STATUS_STALE,
  source_deleted: MESSAGES.LABEL_LINT_STATUS_DELETED,
  excerpt_missing: MESSAGES.LABEL_LINT_STATUS_MISSING,
  model_changed: MESSAGES.LABEL_LINT_STATUS_MODEL
};
var LintModal = class extends import_obsidian28.Modal {
  issues;
  constructor(app, issues) {
    super(app);
    this.issues = issues;
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-modal");
    contentEl.createEl("h2", { text: MESSAGES.TITLE_LINT_RESULTS });
    const grouped = /* @__PURE__ */ new Map();
    for (const issue of this.issues) {
      const list = grouped.get(issue.wiki_page) ?? [];
      list.push(issue);
      grouped.set(issue.wiki_page, list);
    }
    contentEl.createEl("p", {
      text: MESSAGES.LABEL_LINT_ISSUES(this.issues.length, grouped.size),
      cls: "lilbee-lint-summary"
    });
    if (this.issues.length === 0) {
      return;
    }
    for (const [page, issues] of grouped) {
      this.renderGroup(contentEl, page, issues);
    }
  }
  onClose() {
    this.contentEl.empty();
  }
  renderGroup(container, page, issues) {
    const group = container.createDiv({ cls: "lilbee-lint-group" });
    group.createEl("h3", { text: page });
    for (const issue of issues) {
      const row = group.createDiv({ cls: "lilbee-lint-issue" });
      row.createSpan({
        text: issue.citation_key,
        cls: "lilbee-citation-key"
      });
      row.createSpan({
        text: STATUS_LABELS[issue.status],
        cls: `lilbee-lint-status ${STATUS_CLASSES[issue.status]}`
      });
      row.createSpan({
        text: issue.detail,
        cls: "lilbee-lint-detail"
      });
    }
  }
};

// src/views/draft-modal.ts
var import_obsidian29 = require("obsidian");
var NOTICE_DURATION_MS4 = 4e3;
var DraftModal = class extends import_obsidian29.Modal {
  plugin;
  drafts = [];
  selectedSlug = null;
  selectedRow = null;
  draftsTitleEl;
  listEl;
  diffEl;
  acceptBtn;
  rejectBtn;
  actionInFlight = false;
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-modal");
    contentEl.addClass("lilbee-drafts-modal");
    this.renderChrome(contentEl);
    void this.loadList();
  }
  onClose() {
    this.contentEl.empty();
  }
  renderChrome(root) {
    const header = root.createDiv({ cls: "lilbee-drafts-header" });
    this.draftsTitleEl = header.createEl("h2", { text: MESSAGES.TITLE_DRAFTS(0) });
    const refreshBtn = header.createEl("button", {
      text: MESSAGES.LABEL_DRAFT_REFRESH,
      cls: "lilbee-drafts-refresh"
    });
    refreshBtn.addEventListener("click", () => void this.loadList());
    this.listEl = root.createDiv({ cls: "lilbee-drafts-list" });
    this.diffEl = root.createEl("pre", { cls: "lilbee-draft-diff" });
    this.diffEl.setText(MESSAGES.LABEL_DRAFT_NO_SELECTION);
    const actions = root.createDiv({ cls: "lilbee-drafts-actions" });
    this.acceptBtn = actions.createEl("button", {
      text: MESSAGES.LABEL_DRAFT_ACCEPT,
      cls: "mod-cta"
    });
    this.rejectBtn = actions.createEl("button", {
      text: MESSAGES.LABEL_DRAFT_REJECT
    });
    this.acceptBtn.disabled = true;
    this.rejectBtn.disabled = true;
    this.acceptBtn.addEventListener("click", () => void this.accept());
    this.rejectBtn.addEventListener("click", () => void this.reject());
  }
  async loadList() {
    if (this.actionInFlight) return;
    this.selectedSlug = null;
    this.selectedRow = null;
    this.setActionsEnabled(false);
    this.diffEl.setText(MESSAGES.LABEL_DRAFT_NO_SELECTION);
    this.listEl.empty();
    const loading = this.listEl.createDiv({ cls: "lilbee-loading" });
    try {
      this.drafts = await this.plugin.api.wikiDrafts();
    } catch {
      loading.remove();
      this.draftsTitleEl.setText(MESSAGES.TITLE_DRAFTS(0));
      this.listEl.createEl("p", {
        text: MESSAGES.ERROR_LOAD_DRAFTS,
        cls: "lilbee-empty-state"
      });
      return;
    }
    loading.remove();
    this.renderRows();
  }
  renderRows() {
    this.draftsTitleEl.setText(MESSAGES.TITLE_DRAFTS(this.drafts.length));
    this.listEl.empty();
    if (this.drafts.length === 0) {
      this.listEl.createEl("p", {
        text: MESSAGES.LABEL_NO_DRAFTS,
        cls: "lilbee-empty-state"
      });
      return;
    }
    for (const draft of this.drafts) {
      this.renderRow(draft);
    }
  }
  renderRow(draft) {
    const row = this.listEl.createDiv({ cls: "lilbee-draft-row" });
    row.createEl("strong", { text: draft.slug, cls: "lilbee-draft-slug" });
    const meta = row.createDiv({ cls: "lilbee-draft-meta" });
    const kindLabelText = kindChipLabel(draft);
    if (kindLabelText !== null) {
      meta.createSpan({ text: kindLabelText, cls: "lilbee-draft-kind" });
    }
    if (draft.drift_ratio !== null) {
      meta.createSpan({
        text: MESSAGES.LABEL_DRAFT_DRIFT(Math.round(draft.drift_ratio * 100)),
        cls: "lilbee-draft-drift"
      });
    }
    const faithText = draft.faithfulness_score === null ? MESSAGES.LABEL_DRAFT_FAITH_NA : MESSAGES.LABEL_DRAFT_FAITH(draft.faithfulness_score);
    meta.createSpan({ text: faithText, cls: "lilbee-draft-faith" });
    meta.createSpan({
      text: draft.published_exists ? MESSAGES.LABEL_DRAFT_PUBLISHED : MESSAGES.LABEL_DRAFT_NEW,
      cls: "lilbee-draft-pub"
    });
    row.addEventListener("click", () => void this.selectDraft(draft.slug, row));
  }
  async selectDraft(slug, row) {
    if (this.actionInFlight) return;
    this.selectedSlug = slug;
    if (this.selectedRow !== null && this.selectedRow !== row) {
      this.selectedRow.removeClass("is-selected");
    }
    this.selectedRow = row;
    row.addClass("is-selected");
    this.diffEl.empty();
    const loading = this.diffEl.createSpan({ text: "\u2026", cls: "lilbee-loading" });
    let diffText;
    try {
      diffText = await this.plugin.api.wikiDraftDiff(slug);
    } catch {
      if (this.selectedSlug !== slug) return;
      loading.remove();
      this.diffEl.setText(MESSAGES.ERROR_LOAD_DIFF);
      return;
    }
    if (this.selectedSlug !== slug) return;
    loading.remove();
    this.renderDiff(diffText);
    this.setActionsEnabled(true);
  }
  renderDiff(text) {
    this.diffEl.empty();
    if (text.trim() === "") {
      this.diffEl.setText(MESSAGES.LABEL_DRAFT_NO_DIFF);
      return;
    }
    for (const line of text.split("\n")) {
      this.diffEl.createSpan({ text: `${line}
`, cls: diffLineClass(line) });
    }
  }
  async accept() {
    const slug = this.selectedSlug;
    if (slug === null || this.actionInFlight) return;
    this.actionInFlight = true;
    this.setActionsEnabled(false);
    try {
      const confirm = new ConfirmModal(this.app, MESSAGES.NOTICE_CONFIRM_DRAFT_ACCEPT(slug));
      confirm.open();
      if (!await confirm.result) {
        this.setActionsEnabled(true);
        return;
      }
      const result = await this.plugin.api.wikiDraftAccept(slug);
      this.afterActionSuccess(slug, true);
      new import_obsidian29.Notice(MESSAGES.NOTICE_DRAFT_ACCEPTED(result.slug, result.reindexed_chunks), NOTICE_DURATION_MS4);
    } catch {
      new import_obsidian29.Notice(MESSAGES.NOTICE_DRAFT_ACTION_FAILED, NOTICE_DURATION_MS4);
      this.setActionsEnabled(true);
    } finally {
      this.actionInFlight = false;
    }
  }
  async reject() {
    const slug = this.selectedSlug;
    if (slug === null || this.actionInFlight) return;
    this.actionInFlight = true;
    this.setActionsEnabled(false);
    try {
      const confirm = new ConfirmModal(this.app, MESSAGES.NOTICE_CONFIRM_DRAFT_REJECT(slug));
      confirm.open();
      if (!await confirm.result) {
        this.setActionsEnabled(true);
        return;
      }
      await this.plugin.api.wikiDraftReject(slug);
      this.afterActionSuccess(slug, false);
      new import_obsidian29.Notice(MESSAGES.NOTICE_DRAFT_REJECTED(slug), NOTICE_DURATION_MS4);
    } catch {
      new import_obsidian29.Notice(MESSAGES.NOTICE_DRAFT_ACTION_FAILED, NOTICE_DURATION_MS4);
      this.setActionsEnabled(true);
    } finally {
      this.actionInFlight = false;
    }
  }
  afterActionSuccess(slug, wasAccept) {
    const removed = this.drafts.find((d) => d.slug === slug);
    this.drafts = this.drafts.filter((d) => d.slug !== slug);
    this.selectedSlug = null;
    this.selectedRow = null;
    this.diffEl.setText(MESSAGES.LABEL_DRAFT_NO_SELECTION);
    this.renderRows();
    if (this.plugin.wikiDraftCount > 0) this.plugin.wikiDraftCount -= 1;
    if (wasAccept && removed && !removed.published_exists) {
      this.plugin.wikiPageCount += 1;
    }
    if (wasAccept) {
      this.plugin.refreshOpenWikiViews();
      void this.plugin.reconcileWiki();
    }
  }
  setActionsEnabled(enabled) {
    this.acceptBtn.disabled = !enabled;
    this.rejectBtn.disabled = !enabled;
  }
};
var KIND_LABELS = {
  [DRAFT_PENDING_KIND.DRIFT]: MESSAGES.LABEL_DRAFT_KIND_DRIFT,
  [DRAFT_PENDING_KIND.PARSE]: MESSAGES.LABEL_DRAFT_KIND_PARSE,
  [DRAFT_PENDING_KIND.COLLISION]: MESSAGES.LABEL_DRAFT_KIND_COLLISION,
  [DRAFT_PENDING_KIND.LOW_FAITHFULNESS]: MESSAGES.LABEL_DRAFT_KIND_LOW_FAITH,
  [DRAFT_PENDING_KIND.BAD_TITLE]: MESSAGES.LABEL_DRAFT_KIND_BAD_TITLE
};
function kindChipLabel(draft) {
  if (draft.pending_kind !== null) {
    const label = KIND_LABELS[draft.pending_kind];
    if (label !== void 0) return label;
  }
  if (draft.bad_title) return MESSAGES.LABEL_DRAFT_KIND_BAD_TITLE;
  return null;
}
function diffLineClass(line) {
  if (line.startsWith("+++") || line.startsWith("---")) return "lilbee-draft-diff-meta";
  if (line.startsWith("@@")) return "lilbee-draft-diff-hunk";
  if (line.startsWith("+")) return "lilbee-draft-diff-add";
  if (line.startsWith("-")) return "lilbee-draft-diff-del";
  return "lilbee-draft-diff-ctx";
}

// src/views/status-modal.ts
var import_obsidian30 = require("obsidian");
var StatusModal = class extends import_obsidian30.Modal {
  plugin;
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-status-modal");
    contentEl.createEl("h2", { text: MESSAGES.TITLE_STATUS });
    void this.loadStatus(contentEl);
  }
  async loadStatus(contentEl) {
    try {
      const statusResult = await this.plugin.api.status();
      if (statusResult.isErr()) {
        new import_obsidian30.Notice(noticeForResultError(statusResult.error, MESSAGES.ERROR_COULD_NOT_CONNECT));
        this.close();
        return;
      }
      const status = statusResult.value;
      this.renderDocuments(contentEl, status);
      await this.renderModels(contentEl, status);
      this.renderWiki(contentEl, status);
    } catch {
      new import_obsidian30.Notice(MESSAGES.ERROR_COULD_NOT_CONNECT);
      this.close();
    }
  }
  renderDocuments(container, status) {
    const section = container.createEl("details", { attr: { open: "" } });
    section.createEl("summary", { text: MESSAGES.LABEL_STATUS_DOCUMENTS });
    const table = section.createEl("table", { cls: "lilbee-status-table" });
    this.addRow(table, MESSAGES.LABEL_STATUS_DOCUMENTS, String(status.sources.length));
    this.addRow(table, MESSAGES.LABEL_STATUS_CHUNKS, String(status.total_chunks));
  }
  async renderModels(container, status) {
    const section = container.createEl("details", { attr: { open: "" } });
    section.createEl("summary", { text: MESSAGES.LABEL_MODELS });
    const table = section.createEl("table", { cls: "lilbee-status-table" });
    const chatModel = status.config.chat_model;
    this.addModelRow(table, MESSAGES.LABEL_STATUS_CHAT_MODEL, chatModel);
    if (chatModel) {
      await this.renderModelDetails(table, chatModel);
    }
    await this.renderServedContext(table);
    const ocrValue = status.config.enable_ocr;
    const ocrLabel = ocrValue === "true" ? MESSAGES.STATUS_VALUE_OCR_ON : ocrValue === "false" ? MESSAGES.STATUS_VALUE_OCR_OFF : MESSAGES.STATUS_VALUE_OCR_AUTO;
    this.addRow(table, MESSAGES.LABEL_STATUS_OCR, ocrLabel);
  }
  async renderModelDetails(table, model) {
    try {
      const info = await this.plugin.api.showModel(model);
      if (info.architecture) {
        this.addRow(table, MESSAGES.LABEL_STATUS_ARCHITECTURE, info.architecture);
      }
      if (info.context_length) {
        this.addRow(table, MESSAGES.LABEL_STATUS_CONTEXT_LENGTH, info.context_length);
      }
    } catch {
    }
  }
  /** Context window the chat fleet actually serves per slot; absent on older servers or while cold. */
  async renderServedContext(table) {
    const health = await this.plugin.api.health();
    if (health.isErr()) return;
    const ctx = health.value.chat_ctx;
    if (ctx === null || ctx === void 0) return;
    this.addRow(table, MESSAGES.LABEL_STATUS_SERVED_CONTEXT, String(ctx));
  }
  renderWiki(container, status) {
    if (!status.wiki) return;
    const section = container.createEl("details", { attr: { open: "" } });
    section.createEl("summary", { text: MESSAGES.LABEL_STATUS_WIKI });
    const table = section.createEl("table", { cls: "lilbee-status-table" });
    this.addRow(
      table,
      MESSAGES.LABEL_STATUS_WIKI,
      status.wiki.enabled ? MESSAGES.LABEL_STATUS_ENABLED : MESSAGES.LABEL_STATUS_DISABLED
    );
    this.addRow(table, MESSAGES.LABEL_STATUS_WIKI_PAGES, String(status.wiki.page_count));
    this.addRow(table, MESSAGES.LABEL_STATUS_WIKI_DRAFTS, String(status.wiki.draft_count));
    this.addRow(
      table,
      MESSAGES.LABEL_STATUS_WIKI_LAST_LINT,
      status.wiki.last_lint ?? MESSAGES.LABEL_STATUS_NOT_AVAILABLE
    );
  }
  addRow(table, label, value) {
    const row = table.createEl("tr");
    row.createEl("td", { text: label, cls: "lilbee-status-label" });
    row.createEl("td", { text: value, cls: "lilbee-status-value" });
  }
  addModelRow(table, label, model) {
    const row = table.createEl("tr");
    row.createEl("td", { text: label, cls: "lilbee-status-label" });
    const cell = row.createEl("td", { cls: "lilbee-status-value" });
    if (!model) {
      cell.setText(MESSAGES.LABEL_STATUS_NONE);
      return;
    }
    cell.setText(shortModelLabel(model));
    cell.setAttribute("title", model);
  }
};
function shortModelLabel(model) {
  const slash = model.lastIndexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

// src/views/gatekeeper-modal.ts
var import_obsidian31 = require("obsidian");
var GatekeeperModal = class extends import_obsidian31.Modal {
  constructor(app) {
    super(app);
    bindEscapeToClose(this);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("lilbee-gatekeeper-modal");
    contentEl.createEl("h3", { text: MESSAGES.GATEKEEPER_TITLE });
    contentEl.createEl("p", { text: MESSAGES.GATEKEEPER_INTRO });
    const steps = contentEl.createEl("ol");
    steps.createEl("li", { text: MESSAGES.GATEKEEPER_STEP_1 });
    steps.createEl("li", { text: MESSAGES.GATEKEEPER_STEP_2 });
    steps.createEl("li", { text: MESSAGES.GATEKEEPER_STEP_3 });
    contentEl.createEl("p", { text: MESSAGES.GATEKEEPER_RETRY });
    const source = contentEl.createEl("p", { text: `${MESSAGES.GATEKEEPER_SOURCE} ` });
    const repoLink = source.createEl("a", { text: MESSAGES.LINK_LILBEE_REPO });
    repoLink.setAttribute("href", LILBEE_REPO_URL);
    const actions = contentEl.createDiv({ cls: "lilbee-confirm-actions" });
    const gotItBtn = actions.createEl("button", { text: MESSAGES.BUTTON_GOT_IT, cls: "mod-cta" });
    gotItBtn.addEventListener("click", () => this.close());
  }
};

// src/wiki-sync.ts
var MANAGED_MARKER = "lilbee_managed";
function pageVaultPath(folder, page) {
  return `${folder}/${page.slug}.md`;
}
function buildFileContent(page) {
  const content = page.content;
  if (content.startsWith("---\n")) {
    return content.replace("---\n", `---
${MANAGED_MARKER}: true
`);
  }
  return `---
${MANAGED_MARKER}: true
---

${content}`;
}
function isManagedFile(content) {
  return content.includes(MANAGED_MARKER);
}
var WikiSync = class {
  api;
  vault;
  folder;
  constructor(api, vault, folder) {
    this.api = api;
    this.vault = vault;
    this.folder = folder;
  }
  async reconcile() {
    const pages = await this.api.wikiList();
    const publishedPages = pages.filter((p) => PUBLISHED_WIKI_PAGE_TYPES.has(p.page_type));
    await this.ensureFolders(publishedPages);
    let written = 0;
    for (const page of publishedPages) {
      const path = pageVaultPath(this.folder, page);
      const needsWrite = await this.needsUpdate(path, page);
      if (needsWrite) {
        const detail = await this.api.wikiPage(page.slug);
        await this.vault.write(path, buildFileContent(detail));
        written++;
      }
    }
    const removed = await this.removeStalePages(publishedPages);
    return { written, removed };
  }
  async writePage(slug) {
    const detail = await this.api.wikiPage(slug);
    const path = pageVaultPath(this.folder, detail);
    await this.ensureFolders([detail]);
    await this.vault.write(path, buildFileContent(detail));
  }
  async removeStalePages(currentPages) {
    const currentPaths = new Set(currentPages.map((p) => pageVaultPath(this.folder, p)));
    let removed = 0;
    const queue = [this.folder];
    while (queue.length > 0) {
      const dirPath = queue.pop();
      const dirExists = await this.vault.exists(dirPath);
      if (!dirExists) continue;
      const listing = await this.vault.list(dirPath);
      queue.push(...listing.folders);
      for (const filePath of listing.files) {
        if (!filePath.endsWith(".md")) continue;
        if (currentPaths.has(filePath)) continue;
        const content = await this.vault.read(filePath);
        if (isManagedFile(content)) {
          await this.vault.remove(filePath);
          removed++;
        }
      }
    }
    return removed;
  }
  isWikiPath(path) {
    return path.startsWith(this.folder + "/");
  }
  async needsUpdate(path, page) {
    const exists = await this.vault.exists(path);
    if (!exists) return true;
    const content = await this.vault.read(path);
    if (!isManagedFile(content)) return false;
    const match = content.match(/generated_at:\s*(.+)/);
    if (!match) return true;
    return page.created_at === null || match[1].trim() !== page.created_at;
  }
  /**
   * Create every folder the given pages will be written into.
   *
   * Derived from the slugs rather than listed here. The list used to name
   * summaries and concepts only, so entity pages — fifty of the fifty-four in
   * a real wiki — were written into a folder that did not exist. `write`
   * rejects on a missing parent, that aborted the reconcile loop partway, and
   * the caller treats reconcile as best-effort, so most of the wiki silently
   * never reached the vault. Synthesis pages had the same problem.
   */
  async ensureFolders(pages) {
    const dirs = /* @__PURE__ */ new Set([this.folder]);
    for (const page of pages) {
      const segments = `${this.folder}/${page.slug}`.split("/");
      segments.pop();
      for (let i2 = 1; i2 <= segments.length; i2++) {
        dirs.add(segments.slice(0, i2).join("/"));
      }
    }
    for (const dir of [...dirs].sort((a, b) => a.length - b.length)) {
      const exists = await this.vault.exists(dir);
      if (!exists) {
        await this.vault.mkdir(dir);
      }
    }
  }
};

// src/main.ts
var BYTES_PER_MB = 1e6;
var PENDING_SYNC_HINT_DEBOUNCE_MS = 1e3;
var TAKE_OVER_SHUTDOWN_TIMEOUT_MS = 1e4;
var SUPPORTED_SYNC_EXTENSIONS = /* @__PURE__ */ new Set(["md", "pdf", "txt", "html"]);
var UPLOAD_BATCH_MAX_FILES = 90;
var UPLOAD_BATCH_MAX_BYTES = 8 * BYTES_PER_MB;
var MANAGED_DOCS_PREFIX = "lilbee/";
var basename2 = (p) => p.slice(p.lastIndexOf("/") + 1);
function formatSetupDetail(downloaded, total) {
  const dlMB = (downloaded / BYTES_PER_MB).toFixed(1);
  if (total === null) {
    return MESSAGES.STATUS_TASK_SETUP_PROGRESS_INDETERMINATE.replace("{downloaded}", dlMB);
  }
  const totalMB = (total / BYTES_PER_MB).toFixed(1);
  return MESSAGES.STATUS_TASK_SETUP_PROGRESS.replace("{downloaded}", dlMB).replace("{total}", totalMB);
}
function summarizeSyncResult(done) {
  const parts = [];
  if (done.added.length > 0) parts.push(`${done.added.length} added`);
  if (done.updated.length > 0) parts.push(`${done.updated.length} updated`);
  if (done.removed.length > 0) parts.push(`${done.removed.length} removed`);
  if (done.failed.length > 0) parts.push(`${done.failed.length} failed`);
  if (done.skipped.length > 0) parts.push(`${done.skipped.length} skipped`);
  return parts.join(", ");
}
function syncTaskLabel(options) {
  if (options?.forceRebuild) return MESSAGES.COMMAND_SYNC_REBUILD;
  if (options?.retrySkipped) return MESSAGES.COMMAND_SYNC_RETRY_SKIPPED;
  return MESSAGES.COMMAND_SYNC;
}
function countRecentByStatus(completed, status) {
  const now = Date.now();
  return completed.filter(
    (t) => t.status === status && t.completedAt !== null && now - t.completedAt < FLASH_WINDOW_MS
  ).length;
}
var FileProgressTracker = class {
  totalFiles = 1;
  currentFile = 0;
  extractFraction = 0;
  embedFraction = 0;
  startFile(current, total) {
    this.currentFile = current;
    this.totalFiles = Math.max(1, total);
    this.extractFraction = 0;
    this.embedFraction = 0;
  }
  completeFile(current, total) {
    this.currentFile = current + 1;
    this.totalFiles = Math.max(1, total);
    this.extractFraction = 0;
    this.embedFraction = 0;
  }
  setExtractFraction(page, totalPages) {
    if (totalPages <= 0) return;
    this.extractFraction = Math.max(0, Math.min(1, page / totalPages));
  }
  setEmbedFraction(chunk, totalChunks) {
    if (totalChunks <= 0) return;
    this.embedFraction = Math.max(0, Math.min(1, chunk / totalChunks));
  }
  percent() {
    const intra = this.extractFraction * 0.5 + this.embedFraction * 0.5;
    const filesDone = Math.max(0, this.currentFile - 1);
    const pct = (filesDone + intra) / this.totalFiles * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }
};
function parseAddDoneEvent(data) {
  if (!data || typeof data !== "object") return null;
  const obj = data;
  if (obj.sync && typeof obj.sync === "object") {
    return coerceSyncDone(obj.sync);
  }
  return coerceSyncDone(obj);
}
function coerceSyncDone(obj) {
  if (!Array.isArray(obj.added) || !Array.isArray(obj.updated)) return null;
  return {
    added: obj.added,
    updated: obj.updated,
    removed: Array.isArray(obj.removed) ? obj.removed : [],
    unchanged: typeof obj.unchanged === "number" ? obj.unchanged : 0,
    failed: Array.isArray(obj.failed) ? obj.failed : [],
    skipped: Array.isArray(obj.skipped) ? obj.skipped : []
  };
}
function batchUploads(files) {
  const batches = [];
  let current = [];
  let bytes = 0;
  for (const file of files) {
    const size = file.data.byteLength;
    if (current.length > 0 && (current.length >= UPLOAD_BATCH_MAX_FILES || bytes + size > UPLOAD_BATCH_MAX_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
function downloadMessage(progress) {
  const received = formatDiskSize(progress.receivedBytes);
  const percent = percentOfBytes(progress.receivedBytes, progress.totalBytes);
  if (percent === void 0 || progress.totalBytes === null) return MESSAGES.STATUS_DOWNLOAD_RECEIVED(received);
  return MESSAGES.STATUS_DOWNLOAD_PROGRESS(percent, received, formatDiskSize(progress.totalBytes));
}
function downloadStatusBar(progress) {
  const percent = percentOfBytes(progress.receivedBytes, progress.totalBytes);
  if (percent === void 0) return MESSAGES.STATUS_DOWNLOADING;
  return MESSAGES.STATUS_DOWNLOADING_PERCENT(percent);
}
var LilbeePlugin = class extends import_obsidian32.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  api = new LilbeeClient("");
  activeModel = "";
  statusBarEl = null;
  syncPillEl = null;
  chatRibbonIconEl = null;
  binaryManager = null;
  serverManager = null;
  journal = new ErrorJournal();
  vaultRegistry = null;
  vaultId = "";
  syncController = null;
  pendingSyncCount = 0;
  pendingHintTimeout = null;
  previousServerMode = SERVER_MODE.MANAGED;
  startingServer = false;
  serverStartFailed = false;
  unloaded = false;
  // Guards chat-leaf creation against re-entrant duplicate tabs while setViewState is in flight (issue #169).
  openingChatLeaf = false;
  // Same re-entrancy guard for the placement view's main-area tab and beside-chat split.
  openingPlacementLeaf = false;
  taskQueue = new TaskQueue();
  /** Paths whose most-recent add failed — retry skips the reindex confirm. */
  failedAddPaths = /* @__PURE__ */ new Set();
  wikiEnabled = false;
  wikiPageCount = 0;
  wikiDraftCount = 0;
  wikiSync = null;
  healthProbeHandle = null;
  serverUnreachable = false;
  // True when the server is up but the chat role is still cold-loading (from /api/health).
  chatWarming = false;
  // While > 0, probeServerHealth() bails: llama.cpp serializes requests,
  // so /api/health stalls behind the active stream and would falsely flip
  // the status bar to error.
  chatInFlight = 0;
  // Counts consecutive failed probes against HEALTH_FAILURE_STREAK_THRESHOLD.
  healthFailureStreak = 0;
  // External-mode server version, cached from the health probe; managed mode
  // reads the recorded install version instead.
  externalServerVersion = "";
  // The managed server has reached READY at least once this session. Until
  // it has, a failing health probe means "still coming up", not "error" —
  // so a fresh install / first-run wizard doesn't flash a red error pill
  // while the binary downloads and the server boots.
  serverEverReady = false;
  async onload() {
    this.registerErrorCapture();
    await this.loadSettings();
    this.wikiEnabled = this.settings.wikiEnabled;
    if (typeof activeDocument !== "undefined") {
      activeDocument.querySelectorAll(".status-bar-item.plugin-lilbee").forEach((el) => el.remove());
      activeDocument.querySelectorAll(".lilbee-ribbon-icon").forEach((el) => el.remove());
    }
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("lilbee-clickable");
    this.statusBarEl.setAttribute("aria-label", MESSAGES.LABEL_STATUSBAR_OPEN_SETTINGS);
    this.statusBarEl.addEventListener("click", () => this.openPluginSettings());
    this.syncPillEl = this.addStatusBarItem();
    this.syncPillEl.addClass("lilbee-sync-pill");
    this.syncPillEl.addClass("lilbee-clickable");
    this.syncPillEl.hide();
    this.syncPillEl.setAttribute("aria-label", MESSAGES.TOOLTIP_PENDING_SYNC_HINT);
    this.syncPillEl.addEventListener("click", () => void this.triggerSync());
    this.chatRibbonIconEl = this.addRibbonIcon(
      "messages-square",
      MESSAGES.LABEL_RIBBON_OPEN_CHAT,
      () => this.activateChatView()
    );
    this.chatRibbonIconEl.addClass("lilbee-ribbon-icon", "lilbee-ribbon-chat");
    const safeRegisterView = (type, factory) => {
      try {
        this.registerView(type, factory);
      } catch (err3) {
        if (!(err3 instanceof Error) || !/existing view type/.test(err3.message)) throw err3;
      }
    };
    safeRegisterView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
    safeRegisterView(VIEW_TYPE_TASKS, (leaf) => new TaskCenterView(leaf, this));
    safeRegisterView(VIEW_TYPE_WIKI, (leaf) => new WikiView(leaf, this));
    safeRegisterView(VIEW_TYPE_MEMORIES, (leaf) => new MemoriesView(leaf, this));
    safeRegisterView(VIEW_TYPE_PLACEMENT, (leaf) => new PlacementView(leaf, this));
    this.addSettingTab(new LilbeeSettingTab(this.app, this));
    this.taskQueue.onChange(() => this.updateStatusBarFromQueue());
    this.taskQueue.onChange(() => this.schedulePersistHistory());
    this.taskQueue.onChange(() => this.schedulePendingSyncHint());
    this.registerCommands();
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        menu.addItem((item) => {
          item.setTitle(MESSAGES.COMMAND_ADD_TO_LILBEE).setIcon("plus-circle").onClick(() => this.addToLilbee(file));
        });
      })
    );
    if (this.settings.setupCompleted) {
      if (this.settings.serverMode === SERVER_MODE.MANAGED && this.serverUninstalled) {
        this.showNotInstalledStatus();
      } else if (this.settings.serverMode === SERVER_MODE.MANAGED) {
        void this.ensureManagedConsentThenStart().then((outcome) => {
          if (outcome.kind === SETUP_OUTCOME.SWITCHED_TO_EXTERNAL) this.openPluginSettings();
          if (outcome.kind === SETUP_OUTCOME.STARTED) void this.autoUpdateServerBinary();
        });
      } else {
        this.configureApi(this.settings.serverUrl);
        this.setStatusReady();
        void this.fetchActiveModel();
        void this.warnExternalServerOutdated();
      }
    }
    if (!this.settings.setupCompleted) {
      new SetupWizard(this.app, this).open();
    }
    this.registerPendingSyncHintWatchers();
    void this.updatePendingSyncHint();
    this.startHealthProbe();
    this.app.workspace.onLayoutReady(() => {
      this.dedupeLilbeeLeaves();
    });
  }
  /** Collapse multiple lilbee-chat / -tasks / -wiki leaves to one of each. */
  dedupeLilbeeLeaves() {
    for (const type of [VIEW_TYPE_CHAT, VIEW_TYPE_TASKS, VIEW_TYPE_WIKI, VIEW_TYPE_MEMORIES, VIEW_TYPE_PLACEMENT]) {
      const leaves = this.app.workspace.getLeavesOfType(type);
      for (let i2 = 1; i2 < leaves.length; i2++) leaves[i2].detach();
    }
    this.app.workspace.requestSaveLayout?.();
  }
  async startManagedServer(onProgress, allowTakeOver = true) {
    if (this.startingServer) return;
    const registry = this.vaultRegistry;
    if (!registry) return;
    if (this.serverUninstalled) {
      this.showNotInstalledStatus();
      return;
    }
    this.startingServer = true;
    this.serverStartFailed = false;
    try {
      const sharedRoot = registry.sharedRoot;
      this.journal.setLogDir(node.join(registry.resolveDataDir(this.vaultId), LOGS_DIR));
      const foreignDataDir = await this.findLiveForeignServer(registry);
      if (foreignDataDir !== null) {
        window.setTimeout(() => {
          void this.negotiateTakeOver(registry, onProgress, allowTakeOver, foreignDataDir);
        }, 0);
        return;
      }
      this.binaryManager = new BinaryManager(sharedBinDir(sharedRoot));
      const binaryPath = await this.ensureBinaryWithUi(onProgress);
      if (binaryPath === null) return;
      await this.recordLilbeeVersionAfterDownload();
      if (this.unloaded) return;
      try {
        this.serverManager = this.buildServerManager(binaryPath, registry, sharedRoot);
        this.updateStatusBar(MESSAGES.STATUS_STARTING, DOT_STATE.PRIMARY);
        this.setStatusClass("lilbee-status-starting");
        onProgress?.({ phase: MANAGED_PHASE.STARTING, message: MESSAGES.STATUS_STARTING_SERVER });
        await this.serverManager.start();
        this.reconcileRecordedVersion();
        this.configureApi(this.serverManager.serverUrl);
        void this.fetchActiveModel();
        void this.configureManagedStorage();
        void this.runAgentBoot();
        this.recordReadyState();
        onProgress?.({ phase: MANAGED_PHASE.READY, message: "" });
      } catch (err3) {
        if (err3 instanceof ScopeHeldError) {
          this.serverManager = null;
          window.setTimeout(() => {
            void this.negotiateTakeOver(registry, onProgress, allowTakeOver);
          }, 0);
          return;
        }
        this.showError("failed to start server", err3);
        onProgress?.({ phase: MANAGED_PHASE.ERROR, message: errorMessage(err3, String(err3)) });
      }
    } finally {
      this.startingServer = false;
    }
  }
  /**
   * Another vault's server holds the shared root — found by a refused spawn
   * (*knownOwnerDataDir* null, owner read from the scope sidecar) or by the
   * pre-spawn scan for servers predating the locks. Ask the user, ask that
   * server to exit over its API, then start again — the server-side lock
   * grace rides out the handoff. One round only: a second refusal lands in
   * the quiet "serving another vault" state instead of a loop.
   */
  async negotiateTakeOver(registry, onProgress, allowTakeOver = true, knownOwnerDataDir = null) {
    const owner = knownOwnerDataDir ? { dataDir: knownOwnerDataDir, pid: null } : readScopeOwner(registry.sharedRoot);
    const ownerName = owner ? this.lookupVaultNameByDataDir(owner.dataDir) : "another vault";
    if (!allowTakeOver) {
      this.updateStatusBar(MESSAGES.STATUS_LOCKED_BY_OTHER(ownerName), DOT_STATE.MUTED);
      onProgress?.({
        phase: MANAGED_PHASE.ERROR,
        message: MESSAGES.NOTICE_TAKE_OVER_DECLINED(ownerName)
      });
      return;
    }
    const takeOver = await this.confirmTakeOver(ownerName);
    if (!takeOver) {
      this.journal.lifecycle(`take-over of the shared root declined (owner: ${ownerName})`);
      new import_obsidian32.Notice(MESSAGES.NOTICE_TAKE_OVER_DECLINED(ownerName));
      this.updateStatusBar(MESSAGES.STATUS_LOCKED_BY_OTHER(ownerName), DOT_STATE.MUTED);
      onProgress?.({
        phase: MANAGED_PHASE.ERROR,
        message: MESSAGES.NOTICE_TAKE_OVER_DECLINED(ownerName)
      });
      return;
    }
    this.journal.lifecycle(
      `take-over accepted: asking the server of ${ownerName}${owner?.pid != null ? ` (pid ${owner.pid})` : ""} to exit`
    );
    if (owner && !await askServerToExit(owner.dataDir, TAKE_OVER_SHUTDOWN_TIMEOUT_MS)) {
      this.journal.lifecycle(`take-over failed: the server of ${ownerName} did not stop when asked`);
      new import_obsidian32.Notice(MESSAGES.NOTICE_TAKE_OVER_TIMEOUT);
      this.updateStatusBar(MESSAGES.STATUS_LOCKED_BY_OTHER(ownerName), DOT_STATE.MUTED);
      return;
    }
    this.journal.lifecycle(`take-over complete: the server of ${ownerName} is gone; starting ours`);
    new import_obsidian32.Notice(MESSAGES.NOTICE_TAKE_OVER_SUCCESS(ownerName));
    await this.startManagedServer(onProgress, false);
  }
  /**
   * After a spawn, make the recorded version match what the binary reported.
   * A wrong record would otherwise make adoption replace our own healthy
   * server on every plugin reload. Never reconciled from an adopted server:
   * its version may be the stale one a later start is meant to replace.
   */
  reconcileRecordedVersion() {
    const sm = this.serverManager;
    if (!sm || sm.isAdopted || !sm.spawnedVersion) return;
    const reported = sm.spawnedVersion.replace(/^v/, "");
    const recorded = this.getSharedLilbeeVersion();
    if (recorded.replace(/^v/, "") === reported) return;
    this.setSharedLilbeeVersion(`v${reported}`);
    this.journal.lifecycle(
      `recorded server version corrected to v${reported}${recorded ? ` (was ${recorded})` : ""}`
    );
  }
  /** Data dir of a live server another vault started, or null. Our own live server is the adopt path, not a foreigner. */
  async findLiveForeignServer(registry) {
    const ourDataDir = registry.resolveDataDir(this.vaultId);
    if (await serverIsLive(ourDataDir)) return null;
    const others = registry.list().map((e) => registry.resolveDataDir(e.id));
    const foreign = others.filter((dataDir) => dataDir !== ourDataDir);
    const live = await Promise.all(
      foreign.map(async (dataDir) => await serverIsLive(dataDir) ? dataDir : null)
    );
    return live.find((dataDir) => dataDir !== null) ?? null;
  }
  /** Display name of the registered vault whose server serves *dataDir*. */
  lookupVaultNameByDataDir(dataDir) {
    const registry = this.vaultRegistry;
    const entry = registry?.list().find((e) => registry.resolveDataDir(e.id) === dataDir);
    return entry?.displayName ?? "another vault";
  }
  /**
   * Gate run before a first-time managed binary download. When the binary is
   * already present we start straight away; otherwise we ask for consent and
   * route on the user's choice (download / switch-to-external / cancel).
   */
  async ensureManagedConsentThenStart(onProgress) {
    const registry = this.vaultRegistry;
    if (!registry) return { kind: SETUP_OUTCOME.CANCELED };
    const binaryPresent = new BinaryManager(sharedBinDir(registry.sharedRoot)).binaryExists();
    if (binaryPresent && !this.serverUninstalled) {
      await this.startManagedServer(onProgress);
      return { kind: SETUP_OUTCOME.STARTED, mode: SERVER_MODE.MANAGED };
    }
    const result = await new ManagedConsentModal(this.app, this.settings.includeDevBuilds).openConsent();
    if (result.kind === MANAGED_CONSENT_RESULT.DOWNLOAD) {
      this.settings.serverMode = SERVER_MODE.MANAGED;
      this.previousServerMode = SERVER_MODE.MANAGED;
      await this.persistAll();
      this.setServerUninstalled(false);
      await this.startManagedServer(onProgress);
      return { kind: SETUP_OUTCOME.STARTED, mode: SERVER_MODE.MANAGED };
    }
    if (result.kind === MANAGED_CONSENT_RESULT.EXTERNAL) {
      this.settings.serverMode = SERVER_MODE.EXTERNAL;
      this.previousServerMode = SERVER_MODE.EXTERNAL;
      await this.persistAll();
      this.configureApi(this.settings.serverUrl);
      this.setStatusReady();
      new import_obsidian32.Notice(MESSAGES.NOTICE_SWITCHED_TO_EXTERNAL);
      return { kind: SETUP_OUTCOME.SWITCHED_TO_EXTERNAL };
    }
    new import_obsidian32.Notice(MESSAGES.NOTICE_SERVER_DOWNLOAD_CANCELED);
    return { kind: SETUP_OUTCOME.CANCELED };
  }
  buildServerManager(binaryPath, registry, sharedRoot) {
    return new ServerManager({
      binaryPath,
      dataDir: registry.resolveDataDir(this.vaultId),
      sharedRoot,
      modelsDir: sharedModelsDir(sharedRoot),
      ragSystemPrompt: this.settings.ragSystemPrompt,
      generalSystemPrompt: this.settings.generalSystemPrompt,
      installedVersion: this.getSharedLilbeeVersion(),
      onStateChange: (state) => this.handleServerStateChange(state),
      onRestartsExhausted: (output) => {
        if (this.serverStartFailed) return;
        console.error(`[lilbee] server crashed; output:
${output}`);
        this.journal.record("server-crash", MESSAGES.ERROR_SERVER_CRASHED, output || void 0);
        const detail = output ? `
${output.split("\n").slice(-5).join("\n")}` : "";
        const notice = new import_obsidian32.Notice(`${MESSAGES.ERROR_SERVER_CRASHED}${detail}`, NOTICE_PERMANENT);
        this.attachExportLink(notice);
      },
      onShutdownFailure: (err3) => {
        new import_obsidian32.Notice(`${MESSAGES.ERROR_SERVER_SHUTDOWN_FAILED}: ${err3.message}`);
      },
      onJournal: (message) => this.journal.lifecycle(message)
    });
  }
  async confirmTakeOver(ownerName) {
    const modal = new ConfirmModal(this.app, MESSAGES.CONFIRM_TAKE_OVER(ownerName));
    modal.open();
    return modal.result;
  }
  /** Aborts the in-flight server download, if any. Set while a download runs. */
  downloadController = null;
  startDownloadController() {
    this.downloadController = new AbortController();
    return this.downloadController;
  }
  finishDownload() {
    this.downloadController = null;
  }
  /** True while a server binary is downloading, so the UI can offer to stop it. */
  isDownloadingServer() {
    return this.downloadController !== null;
  }
  /** Stop an in-flight server download. The partial file is discarded; any installed binary stays. */
  cancelServerDownload() {
    this.downloadController?.abort();
  }
  async ensureBinaryWithUi(onProgress) {
    const bm = this.binaryManager;
    if (!bm) return null;
    const needsDownload = !bm.binaryExists();
    if (needsDownload) {
      this.updateStatusBar(MESSAGES.STATUS_DOWNLOADING, DOT_STATE.PRIMARY);
      this.setStatusClass("lilbee-status-downloading");
      onProgress?.({ phase: MANAGED_PHASE.DOWNLOADING, message: MESSAGES.STATUS_DOWNLOADING });
    }
    try {
      const path = await bm.ensureBinary(
        this.settings.includeDevBuilds,
        (rawMsg, url, progress) => {
          const percent = progress ? percentOfBytes(progress.receivedBytes, progress.totalBytes) : void 0;
          const msg = progress ? downloadMessage(progress) : rawMsg;
          this.updateStatusBar(progress ? downloadStatusBar(progress) : `lilbee: ${msg}`, DOT_STATE.PRIMARY);
          onProgress?.({ phase: MANAGED_PHASE.DOWNLOADING, message: msg, url, percent });
        },
        () => this.showGatekeeperHelp(),
        this.startDownloadController().signal
      );
      this.finishDownload();
      this.setStatusClass(null);
      return path;
    } catch (err3) {
      this.finishDownload();
      this.setStatusClass(null);
      if (err3 instanceof DownloadCanceledError) {
        new import_obsidian32.Notice(MESSAGES.NOTICE_DOWNLOAD_CANCELED);
        this.updateStatusBar(MESSAGES.STATUS_NOT_INSTALLED, DOT_STATE.MUTED, false);
      } else {
        this.showError("failed to download server", err3);
      }
      onProgress?.({ phase: MANAGED_PHASE.ERROR, message: errorMessage(err3, String(err3)) });
      return null;
    }
  }
  /** Tell the user how to allow the unsigned server when macOS Gatekeeper blocks it. */
  showGatekeeperHelp() {
    new GatekeeperModal(this.app).open();
  }
  async recordLilbeeVersionAfterDownload() {
    if (this.getSharedLilbeeVersion()) return;
    try {
      const release = await getLatestRelease(this.settings.includeDevBuilds);
      this.setSharedLilbeeVersion(release.tag);
      this.setSharedLilbeeVariant(release.variant);
    } catch {
    }
  }
  /** Persist the registry entry once the server is up. */
  recordReadyState() {
    const sm = this.serverManager;
    const registry = this.vaultRegistry;
    if (!sm || !registry) return;
    const now = Date.now();
    const existing = registry.get(this.vaultId);
    registry.upsert({
      id: this.vaultId,
      displayName: existing?.displayName ?? this.getVaultDisplayName(),
      dataDir: sm.dataDir,
      obsidianVaultPath: this.getVaultBasePath(),
      addedAt: existing?.addedAt ?? now,
      lastActiveAt: now
    });
  }
  /** Wiring state for the settings status line; the token it wrote dies with the server. */
  lastAgentWrite = null;
  agentWiring() {
    return new AgentWiring(this.app, this.api);
  }
  /**
   * Rewrite the paired agent's config, then offer the picker if nothing is
   * paired yet. Started with `void` during boot, so it absorbs its own
   * failures rather than surfacing as an unhandled rejection.
   */
  async runAgentBoot() {
    try {
      const { agent, keepConfigFresh } = this.settings.agentIntegration;
      if (agent !== AGENT_SELECTION.NONE) {
        if (keepConfigFresh) await this.applyAgentWiring(agent, { silent: true });
        return;
      }
      await this.maybeShowAgentPicker();
    } catch (err3) {
      this.journal.lifecycle(`agent integration failed: ${errorMessage(err3, String(err3))}`);
    }
  }
  /**
   * Fetch *client*'s config and write it into the vault. A boot refresh passes
   * `silent` so a healthy rewrite says nothing; failures always surface.
   */
  async applyAgentWiring(client, opts) {
    const result = await this.agentWiring().apply(client);
    if (result.isErr()) {
      new import_obsidian32.Notice(MESSAGES.NOTICE_AGENT_CONFIG_FAILED(errorMessage(result.error, String(result.error))));
      return;
    }
    this.lastAgentWrite = result.value;
    if (!opts?.silent) {
      const label = AGENT_LABELS[client];
      new import_obsidian32.Notice(
        result.value.path === null ? MESSAGES.NOTICE_AGENT_CONNECTED_GLOBAL(label) : MESSAGES.NOTICE_AGENT_CONNECTED(label)
      );
    }
    if (result.value.claudian === CLAUDIAN_OUTCOME.WRITTEN && isClaudianLoaded(this.app)) {
      this.offerClaudianReload();
    }
    this.refreshSettingsTab();
  }
  /** Claudian caches its data file at load, so a change only lands after a reload. */
  offerClaudianReload() {
    const notice = new import_obsidian32.Notice(MESSAGES.NOTICE_CLAUDIAN_UPDATED, NOTICE_PERMANENT);
    const link = notice.messageEl.createEl("a", { text: MESSAGES.BUTTON_RELOAD_CLAUDIAN });
    link.addEventListener("click", () => {
      notice.hide();
      void reloadClaudian(this.app);
    });
  }
  /** Offer the picker the first time lilbee sees an agent CLI on this machine. */
  async maybeShowAgentPicker() {
    if (this.settings.agentIntegration.pickerShown) return;
    const index = await this.api.getAgentConfigIndex();
    if (index.isErr()) return;
    const detections = index.value.clients;
    if (!detections.some((d) => d.cli_detected)) return;
    if (this.unloaded) return;
    const modal = new AgentPickerModal(this.app, detections, isClaudianInstalled(this.app));
    const choice = await modal.openPicker();
    if (choice.kind === AGENT_PICKER_RESULT.DISMISS) {
      this.settings.agentIntegration.pickerShown = true;
      await this.persistAgentIntegration();
      return;
    }
    if (choice.remember) {
      this.settings.agentIntegration.agent = choice.client;
      this.settings.agentIntegration.pickerShown = true;
      await this.persistAgentIntegration();
    }
    await this.applyAgentWiring(choice.client);
  }
  /** Agent settings never change the server mode, so they skip saveSettings' restart logic. */
  async persistAgentIntegration() {
    await this.persistAll();
    this.refreshSettingsTab();
  }
  /**
   * Tell the managed server to store content under the vault.
   *
   * PATCHes ``documents_dir`` to ``<vault>/lilbee`` and ``vault_base`` to the
   * vault root. Server performs a locked relocation if paths changed, then
   * stamps ``vault_path`` on every Source response so chat-chip clicks can
   * deep-link into the local editor. No-op when the toggle is off, the
   * server is external, or the current values already match.
   */
  async configureManagedStorage() {
    if (this.settings.serverMode !== SERVER_MODE.MANAGED) return;
    if (!this.settings.storeContentInVault) return;
    const vaultBase = this.getVaultBasePath();
    const desiredDocsDir = `${vaultBase}/lilbee`;
    let current;
    try {
      current = await this.api.config();
    } catch (err3) {
      console.error("[lilbee] could not read server config for vault setup", err3);
      return;
    }
    const currentDocs = typeof current.documents_dir === "string" ? current.documents_dir : "";
    const currentVault = typeof current.vault_base === "string" ? current.vault_base : null;
    if (currentDocs === desiredDocsDir && currentVault === vaultBase) {
      return;
    }
    const notice = new import_obsidian32.Notice(MESSAGES.NOTICE_STORAGE_REORGANIZING, NOTICE_PERMANENT);
    try {
      await this.api.updateConfig({
        documents_dir: desiredDocsDir,
        vault_base: vaultBase
      });
      notice.hide();
      new import_obsidian32.Notice(MESSAGES.NOTICE_STORAGE_REORGANIZED);
    } catch (err3) {
      notice.hide();
      const detail = errorMessage(err3, String(err3));
      new import_obsidian32.Notice(`${MESSAGES.NOTICE_STORAGE_REORGANIZE_FAILED}${detail}`, NOTICE_ERROR_DURATION_MS);
      console.error("[lilbee] storage reorganisation failed", err3);
    }
  }
  /** True when the shared bin dir holds a server binary this vault can run. */
  isServerInstalled() {
    const registry = this.vaultRegistry;
    if (!registry) return false;
    return new BinaryManager(sharedBinDir(registry.sharedRoot)).binaryExists();
  }
  /** Size what an uninstall would delete, so the confirmation can list it. */
  planServerUninstall() {
    const registry = this.vaultRegistry;
    if (!registry) return null;
    return planUninstall(registry.sharedRoot, registry.resolveDataDir(this.vaultId));
  }
  /**
   * Delete the server binary, the shared models, and this vault's index, then
   * remember the choice so no later launch downloads the server again.
   * Returns the bytes freed. Vault documents are never touched.
   */
  async uninstallServer(plan) {
    const registry = this.vaultRegistry;
    if (!registry) return 0;
    const owner = readScopeOwner(registry.sharedRoot);
    const ownDataDir = registry.resolveDataDir(this.vaultId);
    if (owner !== null && owner.dataDir !== ownDataDir) {
      throw new Error(MESSAGES.ERROR_UNINSTALL_SERVER_IN_USE(this.lookupVaultNameByDataDir(owner.dataDir)));
    }
    await this.serverManager?.stop();
    this.serverManager = null;
    this.binaryManager = null;
    if (owner !== null) await askServerToExit(owner.dataDir, TAKE_OVER_SHUTDOWN_TIMEOUT_MS);
    executeUninstall(plan);
    registry.saveConfig({
      ...registry.loadConfig(),
      lilbeeVersion: "",
      lilbeeVariant: "",
      serverAutoUpdate: true,
      serverUninstalled: true
    });
    this.serverUninstalled = true;
    this.serverEverReady = false;
    this.serverUnreachable = false;
    this.showNotInstalledStatus();
    return plan.totalBytes;
  }
  /** Download *release* and start it, clearing an earlier uninstall. */
  async installServer(release, onProgress) {
    this.setServerUninstalled(false);
    await this.updateServer(release, onProgress);
  }
  showNotInstalledStatus() {
    this.updateStatusBar(MESSAGES.STATUS_NOT_INSTALLED, DOT_STATE.MUTED, false);
    this.setStatusClass(null);
  }
  async checkForUpdate() {
    const release = await getLatestRelease(this.settings.includeDevBuilds);
    const versionChanged = checkForUpdate(this.getSharedLilbeeVersion(), release.tag);
    const installedVariant = this.getSharedLilbeeVariant();
    const variantChanged = installedVariant !== "" && installedVariant !== release.variant;
    if (versionChanged || variantChanged) {
      return { available: true, release };
    }
    return { available: false };
  }
  /** Once per plugin version, fetch the latest server release and install it if newer. */
  async autoUpdateServerBinary() {
    const registry = this.vaultRegistry;
    if (!registry) return;
    if (this.serverUninstalled) return;
    const config = registry.loadConfig();
    if (!config.serverAutoUpdate) {
      this.journal.lifecycle("automatic server update skipped: turned off in settings");
      return;
    }
    if (config.lastUpdateCheckPluginVersion === this.manifest.version) return;
    let result;
    try {
      result = await this.checkForUpdate();
    } catch {
      return;
    }
    registry.saveConfig({ ...config, lastUpdateCheckPluginVersion: this.manifest.version });
    if (!result.available || !result.release) return;
    const release = result.release;
    const installedVariant = this.getSharedLilbeeVariant();
    const build = installedVariant !== "" && installedVariant !== release.variant ? MESSAGES.LABEL_SERVER_BUILD(release.variant) : null;
    const notice = new import_obsidian32.Notice(
      build ? MESSAGES.NOTICE_SERVER_SWITCHING_BUILD(build) : MESSAGES.NOTICE_SERVER_AUTO_UPDATING(release.tag),
      NOTICE_PERMANENT
    );
    try {
      await this.updateServer(release);
      new import_obsidian32.Notice(
        build ? MESSAGES.NOTICE_SERVER_SWITCHED_BUILD(build) : MESSAGES.NOTICE_SERVER_AUTO_UPDATED(release.tag)
      );
    } catch {
      new import_obsidian32.Notice(MESSAGES.NOTICE_SERVER_AUTO_UPDATE_FAILED, NOTICE_ERROR_DURATION_MS);
    } finally {
      notice.hide();
    }
  }
  /** External mode: on launch, tell the user when the running server is not the
   *  latest release. Best-effort — silent when offline or the server is unreachable. */
  async warnExternalServerOutdated() {
    try {
      const health = await this.api.health();
      if (health.isErr()) return;
      const latest = (await getLatestRelease(this.settings.includeDevBuilds)).tag.replace(/^v/, "");
      if (!latest || !isVersionOlder(health.value.version, latest)) return;
      new import_obsidian32.Notice(MESSAGES.NOTICE_EXTERNAL_SERVER_OUTDATED(health.value.version, latest), NOTICE_PERMANENT);
    } catch {
    }
  }
  async updateServer(release, onProgress) {
    const registry = this.vaultRegistry;
    if (!registry) return;
    this.journal.lifecycle(
      `updating server binary: ${this.getSharedLilbeeVersion() || "(unknown)"} -> ${release.tag}`
    );
    if (!this.binaryManager) {
      this.binaryManager = new BinaryManager(sharedBinDir(registry.sharedRoot));
    }
    if (this.serverManager) {
      onProgress?.("Stopping server...");
      await this.serverManager.stop();
      this.serverManager = null;
    }
    onProgress?.("Downloading...");
    try {
      await this.binaryManager.download(
        release.assetUrl,
        release.sizeBytes,
        release.digest,
        (msg, _url, progress) => {
          if (!progress) {
            onProgress?.(msg);
            return;
          }
          onProgress?.(
            downloadMessage(progress),
            percentOfBytes(progress.receivedBytes, progress.totalBytes)
          );
        },
        () => this.showGatekeeperHelp(),
        this.startDownloadController().signal
      );
    } finally {
      this.finishDownload();
    }
    this.setSharedLilbeeVersion(release.tag);
    this.setSharedLilbeeVariant(release.variant);
    this.journal.lifecycle(`server binary updated to ${release.tag}`);
    if (this.settings.serverMode === SERVER_MODE.MANAGED) {
      onProgress?.("Starting server...");
      await this.startManagedServer();
    }
    onProgress?.("Update complete.");
  }
  /** Journal lilbee-originated window errors and unhandled rejections. */
  registerErrorCapture() {
    this.registerDomEvent(window, "error", (e) => {
      const stack = e.error instanceof Error ? e.error.stack ?? "" : "";
      if (stack.includes("lilbee")) this.journal.record("window", e.message, stack);
    });
    this.registerDomEvent(window, "unhandledrejection", (e) => {
      const reason = e.reason;
      if (!(reason instanceof Error)) return;
      const stack = reason.stack ?? "";
      if (stack.includes("lilbee")) this.journal.record("unhandledrejection", reason.message, stack);
    });
  }
  attachExportLink(notice) {
    const link = notice.messageEl.createEl("a", { text: MESSAGES.BUTTON_EXPORT_DIAGNOSTICS });
    link.addEventListener("click", () => void exportDiagnostics(this.diagnosticsContext()));
  }
  /** Snapshot of plugin + server state for the diagnostics collector. */
  diagnosticsContext() {
    return {
      dataDir: this.serverManager?.dataDir ?? null,
      sharedRoot: this.vaultRegistry?.sharedRoot ?? null,
      settings: this.settings,
      journalEntries: this.journal.entries,
      pluginVersion: this.manifest.version,
      serverVersion: this.getSharedLilbeeVersion(),
      serverState: this.serverManager?.state ?? SERVER_STATE.STOPPED,
      serverUrl: this.serverManager?.serverUrl ?? this.settings.serverUrl,
      lastOutput: this.serverManager?.lastOutput ?? ""
    };
  }
  showError(label, err3) {
    const detail = errorMessage(err3, String(err3));
    this.journal.record(label, detail, err3 instanceof Error ? err3.stack : void 0);
    console.error(`[lilbee] ${label}:`, err3);
    const output = this.serverManager?.lastOutput;
    if (output) console.error(`[lilbee] server output:
${output}`);
    const outputTail = output ? `
${output.split("\n").slice(-5).join("\n")}` : "";
    const notice = new import_obsidian32.Notice(`lilbee: ${label} \u2014 ${detail}${outputTail}`, NOTICE_ERROR_DURATION_MS);
    if (this.serverManager !== null) this.attachExportLink(notice);
    this.updateStatusBar(MESSAGES.STATUS_ERROR, DOT_STATE.ERROR);
    this.setStatusClass(null);
    this.serverStartFailed = true;
  }
  handleServerStateChange(state) {
    if (this.settings.serverMode === SERVER_MODE.EXTERNAL) return;
    switch (state) {
      case SERVER_STATE.READY:
        if (this.serverManager) {
          this.configureApi(this.serverManager.serverUrl);
        }
        this.serverUnreachable = false;
        this.serverEverReady = true;
        this.setStatusReady();
        this.refreshSettingsTab();
        new import_obsidian32.Notice(MESSAGES.STATUS_READY, NOTICE_DURATION_MS);
        break;
      case SERVER_STATE.STARTING:
        this.updateStatusBar(MESSAGES.STATUS_STARTING, DOT_STATE.PRIMARY);
        this.setStatusClass("lilbee-status-starting");
        break;
      case SERVER_STATE.ERROR:
        this.updateStatusBar(MESSAGES.STATUS_ERROR, DOT_STATE.ERROR);
        this.setStatusClass("lilbee-status-error");
        break;
      case SERVER_STATE.STOPPED:
        this.updateStatusBar(MESSAGES.STATUS_STOPPED, DOT_STATE.MUTED);
        this.setStatusClass(null);
        break;
    }
  }
  getVaultBasePath() {
    const adapter = this.app.vault.adapter;
    return adapter.getBasePath();
  }
  /**
   * Read the lilbee session token.
   *
   * Managed mode: server-manager's dataDir owns the token. `manualToken`
   * is only consulted in external mode -- sending an external-mode paste
   * to the managed server produces a misleading "paste a new token" error.
   *
   * External mode: auto-discovers the user's data root the same way lilbee
   * itself does (LILBEE_DATA env > .lilbee walk-up > platform default).
   */
  readCurrentToken() {
    if (this.settings.serverMode === SERVER_MODE.MANAGED) {
      return this.serverManager ? readSessionToken(this.serverManager.dataDir) : null;
    }
    if (this.settings.manualToken) {
      return this.settings.manualToken;
    }
    const dataRoot = resolveExternalDataRoot(this.getVaultBasePath());
    return readSessionToken(dataRoot);
  }
  /** Point the API client at *baseUrl* and re-bind the hooks. Updates the
   * existing client instance in place so any caller already mid-await on
   * fetchWithRetry (waiting for the server to come up) sees the new URL
   * land instead of being orphaned on a replaced reference. */
  configureApi(baseUrl) {
    this.api.setBaseUrl(baseUrl);
    this.api.setTokenProvider(() => this.readCurrentToken());
    this.api.setToken(this.readCurrentToken());
    this.api.setOutcomeCallback((outcome) => this.handleRequestOutcome(outcome));
  }
  /** Update the status bar to reflect the latest API outcome. */
  handleRequestOutcome(outcome) {
    if (outcome === REQUEST_OUTCOME.OK) {
      this.setStatusReady();
      return;
    }
    if (outcome === REQUEST_OUTCOME.AUTH_ERROR) {
      this.updateStatusBar(MESSAGES.STATUS_AUTH_ERROR, DOT_STATE.ERROR);
      this.setStatusClass("lilbee-status-error");
      return;
    }
    if (outcome === REQUEST_OUTCOME.SERVER_ERROR || outcome === REQUEST_OUTCOME.UNREACHABLE) {
      if (this.settings.serverMode === SERVER_MODE.MANAGED && !this.serverEverReady) return;
      this.updateStatusBar(MESSAGES.STATUS_ERROR, DOT_STATE.ERROR);
      this.setStatusClass("lilbee-status-error");
    }
  }
  /**
   * Whether lilbee can actually serve requests right now. Managed mode
   * needs a live server-manager that isn't flagged unreachable; external
   * mode trusts the user's server until a probe says otherwise.
   *
   * Server-dependent commands gate their checkCallback on this so the
   * command palette doesn't offer (and silently fail) catalog / chat /
   * crawl / sync while the managed server is stopped — when it's down,
   * the only lilbee command offered is the one that starts it.
   */
  isLilbeeReady() {
    if (this.settings.serverMode === SERVER_MODE.EXTERNAL) {
      return !this.serverUnreachable;
    }
    return this.serverManager !== null && !this.serverUnreachable;
  }
  registerCommands() {
    this.addCommand({
      id: "search",
      name: MESSAGES.COMMAND_SEARCH,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) new SearchModal(this.app, this).open();
        return true;
      }
    });
    this.addCommand({
      id: "chat",
      name: MESSAGES.COMMAND_CHAT,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) void this.activateChatView();
        return true;
      }
    });
    this.addCommand({
      id: "open-memories",
      name: MESSAGES.COMMAND_MEMORIES,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) void this.activateMemoriesView();
        return true;
      }
    });
    this.addCommand({
      id: "open-placement",
      name: MESSAGES.COMMAND_PLACEMENT,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) void this.openPlacementGated(() => this.activatePlacementView());
        return true;
      }
    });
    this.addCommand({
      id: "open-placement-beside-chat",
      name: MESSAGES.COMMAND_PLACEMENT_BESIDE_CHAT,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        const chatLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];
        if (!chatLeaf) return false;
        if (!checking) void this.openPlacementGated(() => this.openPlacementBesideChat(chatLeaf));
        return true;
      }
    });
    this.addCommand({
      id: "remember",
      name: MESSAGES.COMMAND_REMEMBER,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) new RememberModal(this.app, this).open();
        return true;
      }
    });
    this.addCommand({
      id: "add-file",
      name: MESSAGES.COMMAND_ADD_FILE,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) void this.addToLilbee(file);
        return true;
      }
    });
    this.addCommand({
      id: "add-folder",
      name: MESSAGES.COMMAND_ADD_FOLDER,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        const file = this.app.workspace.getActiveFile();
        const folder = file?.parent;
        if (!folder) return false;
        if (!checking) void this.addToLilbee(folder);
        return true;
      }
    });
    this.addCommand({
      id: "sync",
      name: MESSAGES.COMMAND_SYNC,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) void this.triggerSync();
        return true;
      }
    });
    this.addCommand({
      id: "sync-retry-skipped",
      name: MESSAGES.COMMAND_SYNC_RETRY_SKIPPED,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) void this.triggerSync({ retrySkipped: true });
        return true;
      }
    });
    this.addCommand({
      id: "sync-rebuild",
      name: MESSAGES.COMMAND_SYNC_REBUILD,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) {
          void (async () => {
            const confirmModal = new ConfirmModal(this.app, MESSAGES.CONFIRM_SYNC_REBUILD);
            confirmModal.open();
            if (await confirmModal.result) void this.triggerSync({ forceRebuild: true });
          })();
        }
        return true;
      }
    });
    this.addCommand({
      id: "export-dataset",
      name: MESSAGES.COMMAND_EXPORT_DATASET,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) void exportDatasetToDisk(this.api);
        return true;
      }
    });
    this.addCommand({
      id: "import-dataset",
      name: MESSAGES.COMMAND_IMPORT_DATASET,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) void importDatasetFromDisk(this.app, this.api, this.taskQueue);
        return true;
      }
    });
    this.addCommand({
      id: "catalog",
      name: MESSAGES.COMMAND_CATALOG,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) new CatalogModal(this.app, this).open();
        return true;
      }
    });
    this.addCommand({
      id: "model-picker-chat",
      name: MESSAGES.COMMAND_MODEL_PICKER_CHAT,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) new ModelPickerModal(this.app, this, MODEL_TASK.CHAT).open();
        return true;
      }
    });
    this.addCommand({
      id: "model-picker-embedding",
      name: MESSAGES.COMMAND_MODEL_PICKER_EMBED,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) new ModelPickerModal(this.app, this, MODEL_TASK.EMBEDDING).open();
        return true;
      }
    });
    this.addCommand({
      id: "model-info-active-chat",
      name: MESSAGES.COMMAND_MODEL_INFO_CHAT,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) void this.openModelInfoForActiveTask(MODEL_TASK.CHAT);
        return true;
      }
    });
    this.addCommand({
      id: "model-info-active-embedding",
      name: MESSAGES.COMMAND_MODEL_INFO_EMBED,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) void this.openModelInfoForActiveTask(MODEL_TASK.EMBEDDING);
        return true;
      }
    });
    this.addCommand({
      id: "crawl",
      name: MESSAGES.COMMAND_CRAWL,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) new CrawlModal(this.app, this).open();
        return true;
      }
    });
    this.addCommand({
      id: "documents",
      name: MESSAGES.COMMAND_DOCUMENTS,
      checkCallback: (checking) => {
        if (!this.isLilbeeReady()) return false;
        if (!checking) new DocumentsModal(this.app, this).open();
        return true;
      }
    });
    this.addCommand({
      id: "setup",
      name: MESSAGES.COMMAND_SETUP,
      callback: () => new SetupWizard(this.app, this).open()
    });
    this.addCommand({
      id: "tasks",
      name: MESSAGES.COMMAND_TASKS,
      callback: () => this.activateTaskView()
    });
    this.addCommand({
      id: "arrange-views",
      name: "Arrange views",
      callback: () => this.arrangeViews()
    });
    this.addCommand({
      id: "wiki",
      name: MESSAGES.COMMAND_WIKI,
      checkCallback: (checking) => {
        if (!this.wikiEnabled) return false;
        if (!checking) void this.activateWikiView();
        return true;
      }
    });
    this.addCommand({
      id: "wiki-lint",
      name: MESSAGES.COMMAND_WIKI_LINT,
      checkCallback: (checking) => {
        if (!this.wikiEnabled) return false;
        if (!checking) void this.runWikiLint();
        return true;
      }
    });
    this.addCommand({
      id: "wiki-drafts",
      name: MESSAGES.COMMAND_REVIEW_DRAFTS,
      checkCallback: (checking) => {
        if (!this.wikiEnabled) return false;
        if (!checking) new DraftModal(this.app, this).open();
        return true;
      }
    });
    this.addCommand({
      id: "wiki-update",
      name: MESSAGES.COMMAND_WIKI_UPDATE,
      checkCallback: (checking) => {
        if (!this.wikiEnabled) return false;
        if (!checking) void this.runWikiUpdate();
        return true;
      }
    });
    this.addCommand({
      id: "status",
      name: MESSAGES.COMMAND_STATUS,
      callback: () => new StatusModal(this.app, this).open()
    });
    this.addCommand({
      id: "export-diagnostics",
      name: MESSAGES.BUTTON_EXPORT_DIAGNOSTICS,
      callback: () => void exportDiagnostics(this.diagnosticsContext())
    });
    this.addCommand({
      id: "take-over",
      name: MESSAGES.COMMAND_TAKE_OVER,
      checkCallback: (checking) => {
        if (this.settings.serverMode !== SERVER_MODE.MANAGED) return false;
        if (this.serverManager !== null) return false;
        if (!checking) void this.startManagedServer();
        return true;
      }
    });
  }
  /**
   * Re-point this vault at a different lilbee data-dir. Used by Settings →
   * "Use existing lilbee data directory" so a user can adopt an existing
   * `lilbee serve` data-dir or one they moved manually from the old layout.
   */
  async adoptDataDir(dataDir) {
    const registry = this.vaultRegistry;
    if (!registry) return;
    const existing = registry.get(this.vaultId);
    const now = Date.now();
    registry.upsert({
      id: this.vaultId,
      displayName: existing?.displayName ?? this.getVaultDisplayName(),
      dataDir,
      obsidianVaultPath: this.getVaultBasePath(),
      addedAt: existing?.addedAt ?? now,
      lastActiveAt: now
    });
    this.journal.lifecycle(`re-pointing this vault at data dir ${dataDir}`);
    if (this.serverManager) {
      await this.serverManager.stop();
      this.serverManager = null;
    }
    if (this.settings.serverMode === SERVER_MODE.MANAGED) {
      await this.startManagedServer();
    }
  }
  onunload() {
    this.unloaded = true;
    if (this.pendingHintTimeout) {
      window.clearTimeout(this.pendingHintTimeout);
      this.pendingHintTimeout = null;
    }
    this.statusBarEl?.remove();
    this.statusBarEl = null;
    this.syncPillEl?.remove();
    this.syncPillEl = null;
    this.taskQueue.dispose();
    if (this.serverManager) {
      this.journal.lifecycle("plugin unloading; stopping the managed server");
      void this.serverManager.stop();
    }
  }
  async loadSettings() {
    const raw = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
    this.settings.agentIntegration = { ...DEFAULT_AGENT_INTEGRATION, ...raw?.agentIntegration ?? {} };
    this.previousServerMode = this.settings.serverMode;
    this.taskQueue.loadFromJSON(raw?.taskHistory);
    this.vaultId = computeVaultId(this.getVaultBasePath());
    this.vaultRegistry = new VaultRegistry(resolveSharedRoot(this.settings.sharedRoot));
    this.serverUninstalled = this.vaultRegistry.loadConfig().serverUninstalled;
  }
  /** Mirrors `SharedConfig.serverUninstalled`; read on every status paint and health probe. */
  serverUninstalled = false;
  isServerUninstalled() {
    return this.serverUninstalled;
  }
  setServerUninstalled(uninstalled) {
    this.serverUninstalled = uninstalled;
    const reg = this.vaultRegistry;
    if (!reg) return;
    reg.saveConfig({ ...reg.loadConfig(), serverUninstalled: uninstalled });
  }
  getSharedLilbeeVersion() {
    return this.vaultRegistry?.loadConfig().lilbeeVersion ?? "";
  }
  setSharedLilbeeVersion(version) {
    const reg = this.vaultRegistry;
    if (!reg) return;
    reg.saveConfig({ ...reg.loadConfig(), lilbeeVersion: version });
  }
  getSharedLilbeeVariant() {
    return this.vaultRegistry?.loadConfig().lilbeeVariant ?? "";
  }
  setSharedLilbeeVariant(variant) {
    const reg = this.vaultRegistry;
    if (!reg) return;
    reg.saveConfig({ ...reg.loadConfig(), lilbeeVariant: variant });
  }
  isServerAutoUpdateEnabled() {
    return this.vaultRegistry?.loadConfig().serverAutoUpdate ?? true;
  }
  setServerAutoUpdate(enabled) {
    const reg = this.vaultRegistry;
    if (!reg) return;
    const config = reg.loadConfig();
    if (config.serverAutoUpdate === enabled) return;
    reg.saveConfig({ ...config, serverAutoUpdate: enabled });
    this.journal.lifecycle(enabled ? "automatic server updates turned on" : "automatic server updates turned off");
  }
  getSharedHfToken() {
    return this.vaultRegistry?.loadConfig().hfToken ?? "";
  }
  setSharedHfToken(token) {
    const reg = this.vaultRegistry;
    if (!reg) return;
    reg.saveConfig({ ...reg.loadConfig(), hfToken: token });
  }
  getVaultDisplayName() {
    const path = this.getVaultBasePath();
    const base = path.split("/").filter(Boolean).pop();
    return base ?? "vault";
  }
  async persistAll() {
    await this.saveData({ ...this.settings, taskHistory: this.taskQueue.toJSON() });
  }
  schedulePersistHistory() {
    void this.persistAll();
  }
  async saveSettings() {
    const previousMode = this.previousServerMode;
    this.previousServerMode = this.settings.serverMode;
    await this.persistAll();
    if (this.settings.serverMode === SERVER_MODE.MANAGED) {
      if (previousMode !== SERVER_MODE.MANAGED) {
        this.journal.lifecycle("server mode switched to managed; starting the managed server");
        void this.startManagedServer();
      }
    } else {
      if (previousMode === SERVER_MODE.MANAGED) {
        this.journal.lifecycle("server mode switched to external; stopping the managed server");
        void this.serverManager?.stop();
        this.serverManager = null;
        this.binaryManager = null;
      }
      this.configureApi(this.settings.serverUrl);
      this.setStatusReady();
      void this.fetchActiveModel();
    }
  }
  updateStatusBar(text, dotState = null, withModel = true) {
    if (!this.statusBarEl) return;
    const label = withModel ? displayLabelForRef(this.activeModel) : "";
    const model = label ? ` (${label})` : "";
    this.statusBarEl.empty();
    if (dotState) {
      const dot = this.statusBarEl.createSpan({ cls: `lilbee-statusbar-dot is-${dotState}` });
      dot.setAttribute("aria-hidden", "true");
    }
    this.statusBarEl.createSpan({ text: `${text}${model}` });
  }
  setStatusClass(cls) {
    if (!this.statusBarEl) return;
    this.statusBarEl.classList.remove(
      "lilbee-status-downloading",
      "lilbee-status-starting",
      "lilbee-status-ready",
      "lilbee-status-adding",
      "lilbee-status-error"
    );
    if (cls) this.statusBarEl.classList.add(cls);
  }
  setStatusReady() {
    if (this.taskQueue.activeAll.length > 0 || this.taskQueue.queued.length > 0) return;
    if (this.settings.serverMode === SERVER_MODE.MANAGED && this.serverUninstalled) {
      this.showNotInstalledStatus();
      return;
    }
    if (this.settings.serverMode === SERVER_MODE.MANAGED && this.serverManager === null) {
      this.updateStatusBar(MESSAGES.STATUS_STOPPED, DOT_STATE.MUTED, false);
      this.setStatusClass(null);
      return;
    }
    const text = this.settings.serverMode === SERVER_MODE.EXTERNAL ? MESSAGES.STATUS_READY_EXTERNAL : MESSAGES.STATUS_READY;
    this.updateStatusBar(text);
    this.setStatusClass("lilbee-status-ready");
  }
  startHealthProbe() {
    if (this.healthProbeHandle !== null) return;
    const handle = window.setInterval(() => void this.probeServerHealth(), HEALTH_PROBE_INTERVAL_MS);
    this.registerInterval(handle);
    this.healthProbeHandle = handle;
  }
  async probeServerHealth() {
    if (this.taskQueue.activeAll.length > 0) return;
    if (this.startingServer) return;
    if (this.chatInFlight > 0) return;
    if (this.serverUninstalled) return;
    this.api.setToken(this.readCurrentToken());
    const health = await this.api.health().catch(() => null);
    if (health?.isOk()) {
      this.healthFailureStreak = 0;
      if (this.settings.serverMode === SERVER_MODE.EXTERNAL) this.externalServerVersion = health.value.version;
      if (this.serverUnreachable) {
        this.serverUnreachable = false;
        void this.fetchActiveModel();
      } else {
        void this.refreshActiveModel();
      }
      this.reflectChatWarmth(health.value);
      return;
    }
    this.healthFailureStreak += 1;
    if (this.healthFailureStreak < HEALTH_FAILURE_STREAK_THRESHOLD) return;
    if (this.settings.serverMode === SERVER_MODE.MANAGED && !this.serverEverReady) return;
    if (this.serverUnreachable) return;
    this.serverUnreachable = true;
    this.updateStatusBar(MESSAGES.STATUS_ERROR, DOT_STATE.ERROR);
    this.setStatusClass("lilbee-status-error");
    this.maybeWarnMissingToken();
  }
  /** Reflect the chat engine's warm state from a health snapshot: show a warming
   * pill while it cold-loads, and revert to ready once it is warm. Older servers
   * omit `chat_ready`, which we treat as ready. */
  reflectChatWarmth(health) {
    const warming = health.chat_ready === false;
    if (warming === this.chatWarming) return;
    this.chatWarming = warming;
    if (warming) {
      this.updateStatusBar(MESSAGES.STATUS_WARMING, DOT_STATE.PRIMARY);
      this.setStatusClass("lilbee-status-starting");
    } else {
      this.setStatusReady();
    }
  }
  notifyChatStart() {
    this.chatInFlight += 1;
  }
  notifyChatEnd() {
    if (this.chatInFlight > 0) this.chatInFlight -= 1;
  }
  missingTokenNoticeFired = false;
  maybeWarnMissingToken() {
    if (this.missingTokenNoticeFired) return;
    if (this.readCurrentToken() !== null) return;
    this.missingTokenNoticeFired = true;
    const msg = this.settings.serverMode === SERVER_MODE.MANAGED ? MESSAGES.NOTICE_NO_TOKEN_MANAGED : MESSAGES.NOTICE_NO_TOKEN_EXTERNAL;
    new import_obsidian32.Notice(msg, NOTICE_DURATION_MS);
  }
  updateStatusBarFromQueue() {
    const allActive = this.taskQueue.activeAll;
    const queued = this.taskQueue.queued;
    const completed = this.taskQueue.completed;
    if (allActive.length === 0 && queued.length === 0) {
      const recent = completed[0];
      if (recent && recent.completedAt !== null && Date.now() - recent.completedAt < FLASH_WINDOW_MS) {
        this.renderStatusFlash(recent, completed);
        return;
      }
      this.setStatusReady();
      return;
    }
    if (allActive.length === 0 && queued.length > 0) {
      this.updateStatusBar(
        `lilbee: ${MESSAGES.STATUS_TASKS_QUEUED_ONLY.replace("{count}", String(queued.length))}`,
        DOT_STATE.PRIMARY
      );
      this.setStatusClass("lilbee-status-adding");
      return;
    }
    const first = allActive[0];
    const pct = first.progress > 0 ? first.progress : 0;
    const suffix = queued.length > 0 ? ` +${queued.length}` : "";
    const indeterminate = first.progress <= INDETERMINATE_PROGRESS;
    if (allActive.length === 1) {
      const text = indeterminate ? MESSAGES.STATUS_TASK_RUNNING_SINGLE_INDETERMINATE.replace("{name}", first.name) : MESSAGES.STATUS_TASK_RUNNING_SINGLE.replace("{name}", first.name).replace("{pct}", String(pct));
      this.updateStatusBar(`lilbee: ${text}${suffix}`, DOT_STATE.PRIMARY);
    } else {
      const text = indeterminate ? MESSAGES.STATUS_TASKS_RUNNING_PLURAL_INDETERMINATE.replace(
        "{count}",
        String(allActive.length)
      ).replace("{name}", first.name) : MESSAGES.STATUS_TASKS_RUNNING_PLURAL.replace("{count}", String(allActive.length)).replace("{name}", first.name).replace("{pct}", String(pct));
      this.updateStatusBar(`lilbee: ${text}${suffix}`, DOT_STATE.PRIMARY);
    }
    this.setStatusClass("lilbee-status-adding");
  }
  renderStatusFlash(recent, completed) {
    if (recent.status === TASK_STATUS.DONE) {
      const recentDone = countRecentByStatus(completed, TASK_STATUS.DONE);
      const text = recentDone > 1 ? MESSAGES.STATUS_TASKS_DONE_FLASH.replace("{count}", String(recentDone)).replace(
        "{name}",
        recent.name
      ) : MESSAGES.STATUS_TASK_DONE_FLASH.replace("{name}", recent.name);
      this.updateStatusBar(`lilbee: ${text}`, DOT_STATE.SUCCESS);
      this.setStatusClass("lilbee-status-ready");
      return;
    }
    if (recent.status === TASK_STATUS.FAILED) {
      const recentFailed = countRecentByStatus(completed, TASK_STATUS.FAILED);
      const template = recentFailed > 1 ? MESSAGES.STATUS_TASKS_FAILED_FLASH : MESSAGES.STATUS_TASK_FAILED_FLASH;
      const text = template.replace("{count}", String(recentFailed)).replace("{name}", recent.name);
      this.updateStatusBar(`lilbee: ${text}`, DOT_STATE.ERROR);
      this.setStatusClass("lilbee-status-error");
      return;
    }
    this.setStatusReady();
  }
  async openModelInfoForActiveTask(task) {
    let cfg;
    try {
      cfg = await this.api.config();
    } catch {
      new import_obsidian32.Notice(MESSAGES.NOTICE_NO_ACTIVE_MODEL(task));
      return;
    }
    const key = task === MODEL_TASK.CHAT ? "chat_model" : "embedding_model";
    const ref = typeof cfg[key] === "string" ? cfg[key] : "";
    if (!ref) {
      new import_obsidian32.Notice(MESSAGES.NOTICE_NO_ACTIVE_MODEL(task));
      return;
    }
    const repo = extractHfRepo(ref);
    const result = await this.api.catalog({ task, search: repo });
    if (result.isErr()) {
      new import_obsidian32.Notice(MESSAGES.NOTICE_NO_ACTIVE_MODEL(task));
      return;
    }
    const entry = result.value.models.find((e) => e.hf_repo === repo) ?? result.value.models[0];
    if (!entry) {
      new import_obsidian32.Notice(MESSAGES.NOTICE_NO_ACTIVE_MODEL(task));
      return;
    }
    new ModelInfoModal(this.app, this, entry).open();
  }
  /** Lightweight active-model resync used on every healthy probe tick, so the
   *  status bar reflects an out-of-band chat-model change. Cheaper than
   *  fetchActiveModel (no wiki/reasoning work); repaints only on a change. */
  async refreshActiveModel() {
    try {
      const models = await this.api.listModels();
      if (models.chat.active === this.activeModel) return;
      this.activeModel = models.chat.active;
      if (!this.chatWarming) this.setStatusReady();
    } catch {
    }
  }
  async fetchActiveModel() {
    try {
      const models = await this.api.listModels();
      this.activeModel = models.chat.active;
      this.setStatusReady();
      await this.applyReasoningDefaultOnce();
    } catch {
    }
    try {
      const status = await this.api.status();
      if (status.isOk()) {
        this.wikiEnabled = this.settings.wikiEnabled;
        this.wikiPageCount = status.value.wiki?.page_count ?? 0;
        this.wikiDraftCount = status.value.wiki?.draft_count ?? 0;
      }
    } catch {
    }
    if (this.wikiEnabled && this.settings.wikiSyncToVault) {
      this.initWikiSync();
      void this.reconcileWiki();
    }
  }
  /** Turn reasoning display on once, the first time we reach a ready server. */
  async applyReasoningDefaultOnce() {
    if (this.settings.reasoningDefaulted) return;
    const cfg = await this.api.config();
    if (cfg.show_reasoning === false) {
      await this.api.updateConfig({ [CONFIG_KEY.SHOW_REASONING]: true });
    }
    this.settings.reasoningDefaulted = true;
    await this.persistAll();
  }
  initWikiSync() {
    this.wikiSync = new WikiSync(this.api, this.app.vault.adapter, this.settings.wikiVaultFolder);
  }
  async reconcileWiki() {
    if (!this.wikiSync) return;
    try {
      const result = await this.wikiSync.reconcile();
      if (result.written > 0 || result.removed > 0) {
        new import_obsidian32.Notice(MESSAGES.NOTICE_WIKI_SYNC(result.written, result.removed), NOTICE_DURATION_MS);
      }
    } catch {
    }
  }
  assertActiveModel() {
    if (this.activeModel) return true;
    new import_obsidian32.Notice(MESSAGES.NOTICE_NO_CHAT_MODEL);
    return false;
  }
  /** Block chat and ingest while the fleet is (re)loading (chat_ready:false), so
   *  requests never hit a half-built fleet. Public so the chat view gates on it too. */
  assertFleetReady() {
    if (!this.chatWarming) return true;
    new import_obsidian32.Notice(MESSAGES.NOTICE_FLEET_WARMING);
    return false;
  }
  /** Saved conversations need the /api/sessions routes, which pre-0.6.90 servers don't have. */
  serverSupportsSessions() {
    return supportsSessions(this.runningServerVersion());
  }
  /** GPU placement needs the /api/placement routes, which pre-0.6.90 servers don't have. */
  serverSupportsPlacement() {
    return supportsPlacement(this.runningServerVersion());
  }
  /** Managed mode knows the install version up front; external mode reports ""
   *  (which fails open) until the first health probe caches one. */
  runningServerVersion() {
    return this.settings.serverMode === SERVER_MODE.MANAGED ? this.getSharedLilbeeVersion() : this.externalServerVersion;
  }
  async confirmReindexIfNeeded(name) {
    try {
      const searchName = name.replace(/\.md$/, "");
      const listing = await this.api.listDocuments(searchName, 1);
      if (listing.documents.length > 0) {
        const modal = new ConfirmModal(this.app, MESSAGES.CONFIRM_REINDEX(searchName));
        modal.open();
        return await modal.result;
      }
    } catch {
    }
    return true;
  }
  async addExternalFiles(paths) {
    if (!this.statusBarEl || paths.length === 0) return;
    if (!this.assertActiveModel()) return;
    if (!this.assertFleetReady()) return;
    const label = paths.length === 1 ? paths[0].split("/").pop() || paths[0] : `${paths.length} files`;
    const isRetry = paths.length === 1 && this.failedAddPaths.has(paths[0]);
    if (paths.length === 1 && !isRetry && !await this.confirmReindexIfNeeded(label)) return;
    const copiedPaths = this.copyExternalFilesToVault(paths);
    if (copiedPaths.length === 0) return;
    new import_obsidian32.Notice(MESSAGES.STATUS_ADDING.replace("{label}", label));
    if (this.settings.serverMode === SERVER_MODE.EXTERNAL) {
      let uploads;
      try {
        uploads = this.readUploadsFromDisk(copiedPaths);
      } catch (err3) {
        console.error("[lilbee] add failed:", err3);
        new import_obsidian32.Notice(MESSAGES.ERROR_ADD_FAILED_DETAIL(errorMessage(err3, MESSAGES.ERROR_CANNOT_CONNECT)));
        return;
      }
      await this.runUpload(uploads, paths, () => this.addExternalFiles(paths));
    } else {
      await this.runAdd(copiedPaths, paths, () => this.addExternalFiles(paths));
    }
  }
  /** Read every file under each path (recursing directories) off disk as
   *  upload payloads — for external mode, where the server can't read paths. */
  readUploadsFromDisk(paths) {
    const out = [];
    const walk = (p) => {
      if (node.statSync(p).isDirectory()) {
        for (const child of node.readdirSync(p)) walk(node.join(p, child));
      } else {
        const buf = node.readFileSync(p);
        out.push({
          name: node.basename(p),
          data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        });
      }
    };
    for (const p of paths) walk(p);
    return out;
  }
  /**
   * Copy each external path into ``<vault>/lilbee/imports/`` and return the
   * new absolute paths for indexing. Paths already under the vault root
   * are returned unchanged. On copy failure the offending file is dropped
   * with a user-visible Notice so the rest of the batch still proceeds.
   *
   * Directory sources are copied recursively with ``node.cpSync`` — the
   * native file picker's "openDirectory" mode returns folder paths, and
   * ``copyFileSync`` on a directory throws EISDIR. Without the stat-first
   * branch every picked folder would fall into the catch and get silently
   * dropped, regressing folder ingestion.
   *
   * All path joins go through ``node.path`` so Windows ``\\`` separators
   * round-trip correctly — a naïve string ``startsWith(vaultBase + "/")``
   * check would miss every file on Windows and mis-copy them into imports.
   */
  copyExternalFilesToVault(paths) {
    const vaultBase = this.getVaultBasePath();
    const importsDir = node.join(vaultBase, "lilbee", "imports");
    try {
      node.mkdirSync(importsDir, { recursive: true });
    } catch (err3) {
      console.error("[lilbee] import dir create failed:", importsDir, err3);
      new import_obsidian32.Notice(MESSAGES.ERROR_FILE_PICKER);
      return [];
    }
    const results = [];
    for (const source of paths) {
      if (this.isUnderVault(source, vaultBase)) {
        results.push(source);
        continue;
      }
      const name = node.basename(source) || "imported";
      const dest = this.uniqueImportPath(importsDir, name);
      try {
        const isDirectory = node.statSync(source).isDirectory();
        if (isDirectory) {
          node.cpSync(source, dest, { recursive: true });
        } else {
          node.copyFileSync(source, dest);
        }
        results.push(dest);
      } catch (err3) {
        console.error("[lilbee] import copy failed:", source, err3);
        new import_obsidian32.Notice(MESSAGES.ERROR_FILE_PICKER);
      }
    }
    return results;
  }
  /**
   * True if ``source`` sits under ``vaultBase``. Normalises separators so
   * ``C:\\vault\\foo.pdf`` correctly matches a vault base of ``C:\\vault``
   * regardless of which slash flavour either side uses.
   */
  isUnderVault(source, vaultBase) {
    const norm = (p) => p.replace(/\\/g, "/");
    const prefix = norm(vaultBase).replace(/\/+$/, "");
    return norm(source).startsWith(`${prefix}/`);
  }
  /** Append a ``-N`` suffix until ``<dir>/<name>`` doesn't exist on disk. */
  uniqueImportPath(dir, name) {
    const candidate = node.join(dir, name);
    if (!node.existsSync(candidate)) return candidate;
    const dot = name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    for (let n = 1; n < 1e3; n++) {
      const next = node.join(dir, `${stem}-${n}${ext}`);
      if (!node.existsSync(next)) return next;
    }
    return node.join(dir, `${stem}-${Date.now()}${ext}`);
  }
  async addToLilbee(file) {
    if (!this.statusBarEl) return;
    if (!this.assertActiveModel()) return;
    if (!this.assertFleetReady()) return;
    const absolutePath = `${this.getVaultBasePath()}/${file.path}`;
    const name = file.name || file.path || MESSAGES.LABEL_VAULT_ROOT;
    const isRetry = this.failedAddPaths.has(absolutePath);
    if (!isRetry && !await this.confirmReindexIfNeeded(name)) return;
    new import_obsidian32.Notice(MESSAGES.STATUS_ADDING.replace("{label}", name));
    if (this.settings.serverMode === SERVER_MODE.EXTERNAL) {
      let uploads;
      try {
        uploads = await this.collectVaultUploads(file);
      } catch (err3) {
        console.error("[lilbee] add failed:", err3);
        new import_obsidian32.Notice(MESSAGES.ERROR_ADD_FAILED_DETAIL(errorMessage(err3, MESSAGES.ERROR_CANNOT_CONNECT)));
        return;
      }
      await this.runUpload(uploads, [absolutePath], () => this.addToLilbee(file));
    } else {
      await this.runAdd([absolutePath], [absolutePath], () => this.addToLilbee(file));
    }
  }
  /** Read every file under *file* (recursing folders) as upload payloads. */
  async collectVaultUploads(file) {
    const tfiles = file instanceof import_obsidian32.TFolder ? this.filesInFolder(file) : file instanceof import_obsidian32.TFile ? [file] : [];
    return Promise.all(tfiles.map(async (f) => ({ name: f.name, data: await this.app.vault.readBinary(f) })));
  }
  filesInFolder(folder) {
    const out = [];
    for (const child of folder.children) {
      if (child instanceof import_obsidian32.TFile) out.push(child);
      else if (child instanceof import_obsidian32.TFolder) out.push(...this.filesInFolder(child));
    }
    return out;
  }
  /** Ingest by uploading file content (external mode); reuses runAdd's stream loop. */
  async runUpload(files, retryKeys, retry) {
    if (files.length === 0) {
      new import_obsidian32.Notice(MESSAGES.STATUS_NOTHING_NEW);
      return;
    }
    await this.runAdd(
      files.map((f) => f.name),
      retryKeys,
      retry,
      (signal) => this.uploadInBatches(files, signal),
      "Uploading files"
    );
  }
  /** Upload files in server-safe batches while presenting one continuous
   *  stream: progress counters are renumbered across the whole set, and a
   *  single merged done event is emitted after the last batch. */
  async *uploadInBatches(files, signal) {
    const batches = batchUploads(files);
    if (batches.length <= 1) {
      yield* this.api.uploadFiles(files, signal);
      return;
    }
    const total = files.length;
    const merged = { added: [], updated: [], removed: [], unchanged: 0, failed: [], skipped: [] };
    let done = 0;
    for (const batch of batches) {
      for await (const event of this.api.uploadFiles(batch, signal)) {
        if (event.event === SSE_EVENT.DONE) {
          const parsed = parseAddDoneEvent(event.data);
          if (parsed) {
            merged.added.push(...parsed.added);
            merged.updated.push(...parsed.updated);
            merged.removed.push(...parsed.removed);
            merged.failed.push(...parsed.failed);
            merged.skipped.push(...parsed.skipped);
            merged.unchanged += parsed.unchanged;
          }
        } else if (event.event === SSE_EVENT.FILE_START) {
          const d = event.data;
          yield {
            event: SSE_EVENT.FILE_START,
            data: { current_file: done + d.current_file, total_files: total }
          };
        } else if (event.event === SSE_EVENT.BATCH_PROGRESS) {
          const d = event.data;
          yield { event: SSE_EVENT.BATCH_PROGRESS, data: { ...d, current: done + d.current, total } };
        } else {
          yield event;
        }
      }
      done += batch.length;
    }
    yield { event: SSE_EVENT.DONE, data: merged };
  }
  cancelSync() {
    this.syncController?.abort();
    this.syncController = null;
  }
  async runAdd(paths, retryKeys = paths, retry, makeStream, label = "Adding files") {
    const taskId = this.taskQueue.enqueue(label, TASK_TYPE.ADD, retry);
    if (taskId === null) {
      new import_obsidian32.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    for (const p of retryKeys) this.failedAddPaths.delete(p);
    this.syncController = new AbortController();
    this.taskQueue.registerAbort(taskId, this.syncController);
    try {
      const progress = new FileProgressTracker();
      let syncResult = null;
      const controller = this.syncController;
      const rawStream = makeStream ? makeStream(controller.signal) : this.api.addFiles(paths, true, controller.signal);
      for await (const event of withIdleTimeout(rawStream, STREAM_IDLE_TIMEOUT_MS, () => controller.abort())) {
        if (event.event === SSE_EVENT.FILE_START) {
          const d = event.data;
          progress.startFile(d.current_file, d.total_files);
          this.taskQueue.update(
            taskId,
            progress.percent(),
            MESSAGES.STATUS_TASK_FILE.replace("{current}", String(d.current_file)).replace(
              "{total}",
              String(d.total_files)
            )
          );
        } else if (event.event === SSE_EVENT.EXTRACT) {
          const d = event.data;
          progress.setExtractFraction(d.page, d.total_pages);
          this.taskQueue.update(
            taskId,
            progress.percent(),
            MESSAGES.STATUS_TASK_EXTRACTING.replace("{file}", d.file).replace("{page}", String(d.page)).replace("{total}", String(d.total_pages))
          );
        } else if (event.event === SSE_EVENT.EMBED) {
          const d = event.data;
          progress.setEmbedFraction(d.chunk, d.total_chunks);
          this.taskQueue.update(
            taskId,
            progress.percent(),
            MESSAGES.STATUS_TASK_EMBEDDING.replace("{chunk}", String(d.chunk)).replace(
              "{total}",
              String(d.total_chunks)
            )
          );
        } else if (event.event === SSE_EVENT.BATCH_PROGRESS) {
          const d = event.data;
          progress.completeFile(d.current, d.total);
          this.taskQueue.update(
            taskId,
            progress.percent(),
            MESSAGES.STATUS_TASK_BATCH(d.current, d.total, d.file, d.status)
          );
        } else if (event.event === SSE_EVENT.DONE) {
          const parsed = parseAddDoneEvent(event.data);
          if (parsed) syncResult = parsed;
        } else if (event.event === SSE_EVENT.ALREADY_INGESTING) {
          const d = event.data ?? {};
          const source = typeof d.source === "string" && d.source ? d.source : paths[0];
          new import_obsidian32.Notice(MESSAGES.NOTICE_ALREADY_INGESTING(source));
          this.taskQueue.markWaiting(taskId, MESSAGES.STATUS_WAITING_ON_SERVER);
          return;
        } else if (event.event === SSE_EVENT.ERROR) {
          const d = event.data;
          const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
          new import_obsidian32.Notice(MESSAGES.ERROR_ADD_FAILED_DETAIL(msg));
          this.taskQueue.fail(taskId, msg);
          this.markAddFailed(retryKeys);
          return;
        }
      }
      if (syncResult) {
        const summary = summarizeSyncResult(syncResult);
        new import_obsidian32.Notice(summary ? MESSAGES.NOTICE_SYNC_SUMMARY(summary) : MESSAGES.STATUS_NOTHING_NEW);
      }
      this.taskQueue.complete(taskId);
    } catch (err3) {
      if (err3 instanceof StreamIdleError) {
        new import_obsidian32.Notice(MESSAGES.ERROR_STREAM_IDLE);
        this.taskQueue.fail(taskId, MESSAGES.ERROR_STREAM_IDLE);
        this.markAddFailed(retryKeys);
      } else if (err3 instanceof Error && err3.name === ERROR_NAME.ABORT_ERROR) {
        new import_obsidian32.Notice(MESSAGES.STATUS_ADD_CANCELLED);
        this.taskQueue.cancel(taskId);
        this.markAddFailed(retryKeys);
      } else if (err3 instanceof SessionTokenError) {
        const msg = sessionTokenInvalidMessage(this.settings.serverMode);
        new import_obsidian32.Notice(msg);
        this.taskQueue.fail(taskId, msg);
        this.markAddFailed(retryKeys);
      } else {
        console.error("[lilbee] add failed:", err3);
        const msg = errorMessage(err3, MESSAGES.ERROR_CANNOT_CONNECT);
        new import_obsidian32.Notice(MESSAGES.ERROR_ADD_FAILED_DETAIL(msg));
        this.taskQueue.fail(taskId, msg);
        this.markAddFailed(retryKeys);
      }
    } finally {
      this.syncController = null;
    }
  }
  markAddFailed(paths) {
    for (const p of paths) this.failedAddPaths.add(p);
  }
  async activateTaskView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKS);
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_TASKS, active: true });
      void this.app.workspace.revealLeaf(leaf);
    }
  }
  refreshOpenWikiViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WIKI)) {
      void leaf.view.refresh();
    }
  }
  async activateMemoriesView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMORIES);
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_MEMORIES, active: true });
      void this.app.workspace.revealLeaf(leaf);
    }
  }
  refreshMemoryViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MEMORIES)) {
      void leaf.view.reload();
    }
  }
  /** When the running server predates the /api/placement routes, explain and
   *  offer to jump straight to Settings, where the version picker lives. */
  async openPlacementGated(open) {
    if (this.serverSupportsPlacement()) {
      await open();
      return;
    }
    const modal = new ConfirmModal(this.app, MESSAGES.PLACEMENT_UPDATE_SERVER_PROMPT);
    modal.open();
    if (await modal.result) this.openPluginSettings();
  }
  /** Open the placement view in a main-area tab (it is wider than the sidebar views). */
  async activatePlacementView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PLACEMENT);
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    if (this.openingPlacementLeaf) return;
    this.openingPlacementLeaf = true;
    try {
      const leaf = this.app.workspace.getLeaf("tab");
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_PLACEMENT, active: true });
        void this.app.workspace.revealLeaf(leaf);
      }
    } finally {
      this.openingPlacementLeaf = false;
    }
  }
  async openPlacementBesideChat(chatLeaf) {
    if (this.openingPlacementLeaf) return;
    this.openingPlacementLeaf = true;
    try {
      await revealPlacementBeside(this.app, chatLeaf);
    } finally {
      this.openingPlacementLeaf = false;
    }
  }
  openPluginSettings() {
    openPluginSettingsById(this.app, this.manifest.id);
  }
  /**
   * Re-render the Settings tab if (and only if) the open tab is ours.
   * Called whenever server-owned state — active models, persisted config,
   * server reachability — changes from somewhere other than the Settings
   * UI itself, so the rendered controls don't lie about the live state.
   */
  refreshSettingsTab() {
    const setting = this.app.setting;
    const activeTab = setting?.activeTab;
    if (activeTab instanceof LilbeeSettingTab) {
      activeTab.render();
    }
  }
  // Re-sync the model rail in every open chat view after a model is switched
  // elsewhere (e.g. the catalog), so the pills don't show a stale selection.
  refreshOpenChatRails() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT)) {
      const view = leaf.view;
      if (view instanceof ChatView) view.refreshRail();
    }
  }
  async activateWikiView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_WIKI);
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_WIKI, active: true });
      void this.app.workspace.revealLeaf(leaf);
    }
  }
  async activateChatView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    if (this.openingChatLeaf) return;
    this.openingChatLeaf = true;
    try {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
        void this.app.workspace.revealLeaf(leaf);
      }
    } finally {
      this.openingChatLeaf = false;
    }
  }
  /**
   * Tile the plugin's views as side-by-side columns in the main area: chat and
   * the Task Center always, plus wiki, memories, and placement when they are
   * already open. Reuses open leaves (chat keeps its conversation) and splits
   * any it has to create beside the previous one. Bind a hotkey in Settings → Hotkeys.
   */
  async arrangeViews() {
    if (this.openingChatLeaf) return;
    this.openingChatLeaf = true;
    try {
      const workspace = this.app.workspace;
      const included = [
        VIEW_TYPE_CHAT,
        VIEW_TYPE_TASKS,
        VIEW_TYPE_WIKI,
        VIEW_TYPE_MEMORIES,
        VIEW_TYPE_PLACEMENT
      ].filter(
        (type) => type === VIEW_TYPE_CHAT || type === VIEW_TYPE_TASKS || workspace.getLeavesOfType(type).length > 0
      );
      let anchor = null;
      for (const type of included) {
        let leaf = workspace.getLeavesOfType(type)[0] ?? null;
        if (!leaf) {
          leaf = anchor ? workspace.createLeafBySplit(anchor, "vertical") : workspace.getLeaf("tab");
          if (!leaf) continue;
          await leaf.setViewState({ type, active: true });
        }
        anchor = leaf;
      }
      for (const type of included) {
        const leaf = workspace.getLeavesOfType(type)[0];
        if (leaf) void workspace.revealLeaf(leaf);
      }
    } finally {
      this.openingChatLeaf = false;
    }
  }
  registerPendingSyncHintWatchers() {
    const handler = (file) => {
      if (this.wikiSync?.isWikiPath(file.path)) return;
      if (file.path.startsWith("lilbee/")) return;
      this.schedulePendingSyncHint();
    };
    const vault = this.app.vault;
    this.registerEvent(vault.on("create", handler));
    this.registerEvent(vault.on("modify", handler));
    this.registerEvent(vault.on("delete", handler));
    this.registerEvent(vault.on("rename", handler));
  }
  schedulePendingSyncHint() {
    if (this.pendingHintTimeout) {
      window.clearTimeout(this.pendingHintTimeout);
    }
    this.pendingHintTimeout = window.setTimeout(() => {
      this.pendingHintTimeout = null;
      if (!this.statusBarEl) return;
      void this.updatePendingSyncHint();
    }, PENDING_SYNC_HINT_DEBOUNCE_MS);
  }
  async countPendingSync() {
    if (this.settings.serverMode !== SERVER_MODE.MANAGED || !this.settings.storeContentInVault) {
      return 0;
    }
    const files = this.app?.vault?.getFiles?.();
    if (!Array.isArray(files)) return 0;
    const docFiles = files.filter((f) => SUPPORTED_SYNC_EXTENSIONS.has(f.extension.toLowerCase())).filter((f) => f.path.startsWith(MANAGED_DOCS_PREFIX) && !this.wikiSync?.isWikiPath(f.path));
    const known = /* @__PURE__ */ new Set();
    try {
      let offset = 0;
      const limit = 100;
      while (true) {
        const page = await this.api.listDocuments(void 0, limit, offset);
        for (const d of page.documents) known.add(basename2(d.filename));
        if (!page.has_more || page.documents.length === 0) break;
        offset += page.documents.length;
      }
    } catch {
      return 0;
    }
    return docFiles.filter((f) => !known.has(f.name)).length;
  }
  async updatePendingSyncHint() {
    if (!this.syncPillEl) return;
    const count = await this.countPendingSync();
    if (!this.syncPillEl) return;
    this.pendingSyncCount = count;
    if (count > 0) {
      this.syncPillEl.setText(MESSAGES.STATUS_SYNC_PILL(count));
      this.syncPillEl.show();
    } else {
      this.syncPillEl.hide();
    }
  }
  async runWikiLint() {
    const taskId = this.taskQueue.enqueue("Wiki lint", TASK_TYPE.WIKI);
    if (taskId === null) {
      new import_obsidian32.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    try {
      const result = await this.api.wikiLint();
      this.taskQueue.complete(taskId);
      new import_obsidian32.Notice(MESSAGES.NOTICE_WIKI_LINT_DONE(result.issues.length), NOTICE_DURATION_MS);
      new LintModal(this.app, result.issues).open();
    } catch (err3) {
      const msg = errorMessage(err3, MESSAGES.ERROR_UNKNOWN);
      this.taskQueue.fail(taskId, msg);
    }
  }
  /**
   * Refresh the wiki across every ingested source.
   *
   * The run issues per-source LLM calls and can take minutes, so the server
   * streams its progress and closes with a `done` event carrying the summary.
   * Aborting stops it at the next source boundary and releases the server's
   * build mutex, so a cancelled run does not block the other wiki commands.
   */
  async runWikiUpdate() {
    const taskId = this.taskQueue.enqueue(MESSAGES.TASK_WIKI_UPDATE, TASK_TYPE.WIKI);
    if (taskId === null) {
      new import_obsidian32.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    const controller = new AbortController();
    this.taskQueue.registerAbort(taskId, controller);
    try {
      let count = 0;
      for await (const event of this.api.wikiUpdate(controller.signal)) {
        if (event.event === SSE_EVENT.WIKI_PAGE) {
          const d = event.data;
          const pct = d.total > 0 ? Math.round(d.current / d.total * 100) : -1;
          this.taskQueue.update(taskId, pct, MESSAGES.TASK_WIKI_PAGE(d.label, d.current, d.total));
        } else if (event.event === SSE_EVENT.WIKI_PHASE) {
          const d = event.data;
          this.taskQueue.update(taskId, -1, MESSAGES.TASK_WIKI_PHASE(d.phase));
        } else if (event.event === SSE_EVENT.DONE) {
          count = event.data.count;
        } else if (event.event === SSE_EVENT.ERROR) {
          const d = event.data;
          throw new Error(extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN));
        }
      }
      this.taskQueue.complete(taskId);
      new import_obsidian32.Notice(MESSAGES.NOTICE_WIKI_UPDATE_DONE(count), NOTICE_DURATION_MS);
      this.refreshOpenWikiViews();
      if (this.wikiSync) {
        void this.reconcileWiki();
      }
    } catch (err3) {
      this.taskQueue.fail(taskId, errorMessage(err3, MESSAGES.ERROR_UNKNOWN));
    }
  }
  async runWikiPrune() {
    const modal = new ConfirmModal(this.app, MESSAGES.NOTICE_WIKI_PRUNE_CONFIRM);
    modal.open();
    const confirmed = await modal.result;
    if (!confirmed) return;
    const taskId = this.taskQueue.enqueue("Wiki prune", TASK_TYPE.WIKI);
    if (taskId === null) {
      new import_obsidian32.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    try {
      const result = await this.api.wikiPrune();
      this.taskQueue.complete(taskId);
      new import_obsidian32.Notice(MESSAGES.NOTICE_WIKI_PRUNE_DONE(result.archived), NOTICE_DURATION_MS);
      this.refreshOpenWikiViews();
      if (this.wikiSync) {
        void this.reconcileWiki();
      }
    } catch (err3) {
      const msg = errorMessage(err3, MESSAGES.ERROR_UNKNOWN);
      this.taskQueue.fail(taskId, msg);
    }
  }
  async runCrawl(url, depth, maxPages, renderMode, includeSubdomains) {
    const taskId = this.taskQueue.enqueue(`Crawl ${url}`, TASK_TYPE.CRAWL);
    if (taskId === null) {
      new import_obsidian32.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    const controller = new AbortController();
    this.taskQueue.registerAbort(taskId, controller);
    let setupTaskId = null;
    let setupResolved = false;
    try {
      let pageCount = 0;
      const rawStream = this.api.crawl(url, depth, maxPages, controller.signal, renderMode, includeSubdomains);
      for await (const event of withIdleTimeout(rawStream, STREAM_IDLE_TIMEOUT_MS, () => controller.abort())) {
        switch (event.event) {
          case SSE_EVENT.SETUP_START: {
            this.taskQueue.update(taskId, -1, MESSAGES.STATUS_TASK_CRAWLER_PREPARING);
            const d = event.data;
            if (d.size_estimate_bytes && setupTaskId === null) {
              setupTaskId = this.taskQueue.enqueue("Chromium setup", TASK_TYPE.SETUP);
              if (setupTaskId !== null) {
                this.taskQueue.update(setupTaskId, 0, formatSetupDetail(0, d.size_estimate_bytes));
              }
            }
            break;
          }
          case SSE_EVENT.SETUP_PROGRESS: {
            if (setupTaskId === null) break;
            const d = event.data;
            const pct = d.total_bytes ? d.downloaded_bytes / d.total_bytes * 100 : -1;
            this.taskQueue.update(setupTaskId, pct, formatSetupDetail(d.downloaded_bytes, d.total_bytes));
            break;
          }
          case SSE_EVENT.SETUP_DONE: {
            const d = event.data;
            setupResolved = true;
            if (d.success) {
              if (setupTaskId !== null) this.taskQueue.complete(setupTaskId);
              this.taskQueue.update(taskId, -1, "");
            } else {
              const err3 = d.error ?? MESSAGES.ERROR_UNKNOWN;
              if (setupTaskId !== null) this.taskQueue.fail(setupTaskId, err3);
              this.taskQueue.fail(taskId, MESSAGES.ERROR_CRAWLER_SETUP_FAILED_SHORT);
              new import_obsidian32.Notice(MESSAGES.ERROR_CRAWLER_SETUP_FAILED.replace("{error}", err3));
              return;
            }
            break;
          }
          case SSE_EVENT.CRAWL_START:
            break;
          case SSE_EVENT.CRAWL_PAGE: {
            pageCount++;
            this.taskQueue.update(taskId, -1, `${pageCount} pages`);
            break;
          }
          case SSE_EVENT.CRAWL_DONE: {
            const d = event.data;
            this.taskQueue.complete(taskId);
            new import_obsidian32.Notice(MESSAGES.NOTICE_CRAWL_DONE(d.pages_crawled ?? pageCount));
            void this.triggerSync();
            return;
          }
          case SSE_EVENT.CRAWL_ERROR:
          case SSE_EVENT.ERROR: {
            const d = event.data;
            this.taskQueue.fail(taskId, d.message ?? "unknown");
            new import_obsidian32.Notice(MESSAGES.ERROR_CRAWL_ERROR.replace("{msg}", d.message ?? "unknown"));
            return;
          }
        }
      }
      this.taskQueue.complete(taskId);
    } catch (err3) {
      if (setupTaskId !== null && !setupResolved) {
        this.taskQueue.fail(setupTaskId, MESSAGES.ERROR_CRAWLER_SETUP_FAILED_SHORT);
      }
      if (err3 instanceof StreamIdleError) {
        new import_obsidian32.Notice(MESSAGES.ERROR_STREAM_IDLE);
        this.taskQueue.fail(taskId, MESSAGES.ERROR_STREAM_IDLE);
        return;
      }
      const msg = errorMessage(err3, MESSAGES.ERROR_UNKNOWN);
      this.taskQueue.fail(taskId, msg);
      new import_obsidian32.Notice(MESSAGES.ERROR_CRAWL_FAILED.replace("{msg}", msg));
    }
  }
  async triggerSync(options) {
    if (!this.statusBarEl) return;
    if (this.taskQueue.hasPending(TASK_TYPE.SYNC)) return;
    const taskId = this.taskQueue.enqueue(syncTaskLabel(options), TASK_TYPE.SYNC);
    if (taskId === null) {
      new import_obsidian32.Notice(MESSAGES.NOTICE_QUEUE_FULL);
      return;
    }
    this.syncController = new AbortController();
    this.taskQueue.registerAbort(taskId, this.syncController);
    try {
      const progress = new FileProgressTracker();
      let syncResult = null;
      const controller = this.syncController;
      const rawStream = this.api.syncStream(controller.signal, options);
      for await (const event of withIdleTimeout(rawStream, STREAM_IDLE_TIMEOUT_MS, () => controller.abort())) {
        if (event.event === SSE_EVENT.FILE_START) {
          const d = event.data;
          progress.startFile(d.current_file, d.total_files);
          this.taskQueue.update(
            taskId,
            progress.percent(),
            MESSAGES.STATUS_TASK_SYNCING_FILE.replace("{current}", String(d.current_file)).replace(
              "{total}",
              String(d.total_files)
            )
          );
        } else if (event.event === SSE_EVENT.EXTRACT) {
          const d = event.data;
          progress.setExtractFraction(d.page, d.total_pages);
          this.taskQueue.update(
            taskId,
            progress.percent(),
            MESSAGES.STATUS_TASK_EXTRACTING.replace("{file}", d.file).replace("{page}", String(d.page)).replace("{total}", String(d.total_pages))
          );
        } else if (event.event === SSE_EVENT.EMBED) {
          const d = event.data;
          progress.setEmbedFraction(d.chunk, d.total_chunks);
          this.taskQueue.update(
            taskId,
            progress.percent(),
            MESSAGES.STATUS_TASK_EMBEDDING.replace("{chunk}", String(d.chunk)).replace(
              "{total}",
              String(d.total_chunks)
            )
          );
        } else if (event.event === SSE_EVENT.BATCH_PROGRESS) {
          const d = event.data;
          progress.completeFile(d.current, d.total);
          this.taskQueue.update(
            taskId,
            progress.percent(),
            MESSAGES.STATUS_TASK_BATCH(d.current, d.total, d.file, d.status)
          );
        } else if (event.event === SSE_EVENT.DONE) {
          const parsed = parseAddDoneEvent(event.data);
          if (parsed) syncResult = parsed;
        } else if (event.event === SSE_EVENT.ERROR) {
          const d = event.data;
          const msg = extractSseErrorMessage(d, MESSAGES.ERROR_UNKNOWN);
          new import_obsidian32.Notice(MESSAGES.STATUS_SYNC_FAILED);
          this.taskQueue.fail(taskId, msg);
          return;
        }
      }
      if (syncResult) {
        const summary = summarizeSyncResult(syncResult);
        if (summary) new import_obsidian32.Notice(MESSAGES.STATUS_SYNCED.replace("{summary}", summary));
      }
      this.taskQueue.complete(taskId);
    } catch (err3) {
      if (err3 instanceof StreamIdleError) {
        new import_obsidian32.Notice(MESSAGES.ERROR_STREAM_IDLE);
        this.taskQueue.fail(taskId, MESSAGES.ERROR_STREAM_IDLE);
      } else if (err3 instanceof Error && err3.name === ERROR_NAME.ABORT_ERROR) {
        new import_obsidian32.Notice(MESSAGES.STATUS_SYNC_CANCELLED);
        this.taskQueue.cancel(taskId);
      } else if (err3 instanceof SessionTokenError) {
        const msg = sessionTokenInvalidMessage(this.settings.serverMode);
        new import_obsidian32.Notice(msg);
        this.taskQueue.fail(taskId, msg);
      } else {
        console.error("[lilbee] sync failed:", err3);
        new import_obsidian32.Notice(MESSAGES.STATUS_SYNC_FAILED);
        this.taskQueue.fail(taskId, MESSAGES.ERROR_CANNOT_CONNECT);
      }
    } finally {
      this.syncController = null;
      this.schedulePendingSyncHint();
    }
  }
};

/* nosourcemap */