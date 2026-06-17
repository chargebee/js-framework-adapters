import type Chargebee from "chargebee";

/**
 * Canonical, provider-agnostic LLM usage shape. Every adapter — built-in or
 * custom — produces a value of this shape. The meter only emits non-zero
 * fields, so adapters can return a sparse {@link Partial} safely.
 */
export interface CanonicalUsage {
	/** Prompt tokens. */
	input: number;
	/** Completion tokens. */
	output: number;
	/** Prompt tokens served from cache. */
	cache_read: number;
	/** Prompt tokens written to cache (default TTL). */
	cache_write: number;
	/** 5-minute TTL cache write. */
	cache_write_5m: number;
	/** 1-hour TTL cache write. */
	cache_write_1h: number;
	/** Reasoning / thinking tokens. */
	reasoning: number;
	/** Tool / function invocation count. */
	tool_calls: number;
	/** Image input tokens. */
	image_input: number;
	/** Audio input tokens. */
	audio_input: number;
}

export type CanonicalUsageField = keyof CanonicalUsage;

/**
 * Default mapping from canonical field → property key on the Chargebee usage
 * event. Customers configure their metered features against these keys (or
 * override via {@link MeterOptions.metricMapping}).
 */
export const DEFAULT_METRIC_MAPPING: Record<CanonicalUsageField, string> = {
	input: "input_tokens",
	output: "output_tokens",
	cache_read: "cache_read_tokens",
	cache_write: "cache_write_tokens",
	cache_write_5m: "cache_write_5m_tokens",
	cache_write_1h: "cache_write_1h_tokens",
	reasoning: "reasoning_tokens",
	tool_calls: "tool_calls",
	image_input: "image_input_tokens",
	audio_input: "audio_input_tokens",
};

/** Arbitrary properties attached to a usage event (filterable in Chargebee). */
export type EventProperties = Record<
	string,
	string | number | boolean | null | undefined
>;

/**
 * Per-call or per-context override. Higher-priority than the meter defaults.
 */
export interface CallContext {
	subscriptionId?: string;
	properties?: EventProperties;
	/**
	 * Override the timestamp recorded on the Chargebee usage event. Useful for
	 * replaying historical events. Defaults to `Date.now()`.
	 */
	usageTimestampMs?: number;
	/**
	 * Stable identifier for this LLM call. Used as the basis for the Chargebee
	 * `deduplication_id`. If omitted, the meter generates a UUID.
	 */
	requestId?: string;
}

/**
 * Resolved context after applying meter defaults → context → per-call override.
 */
export interface ResolvedContext {
	subscriptionId: string;
	properties: EventProperties;
	usageTimestampMs: number;
	requestId: string;
}

export type FlushMode = "background" | "onCall";

/** Where an internal failure occurred. Stable strings, safe to switch on. */
export type ErrorSite =
	| "wrap"
	| "extractUsage"
	| "record"
	| "flush"
	| "batchIngest"
	| "shutdown"
	| (string & {});

/** Options for constructing a {@link UsageMeter}. */
export interface MeterOptions {
	/** Pre-built Chargebee SDK client. Peer dependency, not bundled. */
	chargebee: Chargebee;

	/** Subscription to bill when no per-call / context override is present. */
	defaultSubscriptionId?: string;

	/** Override the canonical field → property key mapping. */
	metricMapping?: Partial<Record<CanonicalUsageField, string>>;

	/** Properties merged into every event's `properties` (e.g. `{ env: "prod" }`). */
	defaultProperties?: EventProperties;

	/** Background flush cadence in ms. Default: 1000. */
	flushIntervalMs?: number;

	/**
	 * Max events per `batchIngest` request. Default: 100. Chargebee's documented
	 * ceiling is 500; values above that are clamped.
	 */
	maxBatchSize?: number;

	/** Hard cap on buffered events; oldest events are dropped on overflow. Default: 10_000. */
	maxBufferSize?: number;

	/** Max exponential backoff between retries (ms). Default: 60_000. */
	maxRetryMs?: number;

	/**
	 * `"background"` (default): use `setInterval` to flush periodically.
	 * `"onCall"`: flush synchronously per call. Recommended for edge runtimes
	 * (Vercel Edge, Cloudflare Workers) where long-running timers don't survive.
	 */
	flushMode?: FlushMode;

	/**
	 * Called on every internal failure. Wire this into your error tracker
	 * (Sentry / Datadog). Defaults to `console.error`.
	 */
	onError?: (err: Error, where: ErrorSite) => void;
}

/**
 * Context passed to adapter `wrap()` implementations. Adapters use this to
 * record extracted usage and to surface internal failures.
 */
export interface WrapContext {
	/** Record one LLM call's worth of usage. Non-blocking. */
	record(usage: Partial<CanonicalUsage>, callContext?: CallContext): void;
	/** Report an instrumentation failure. The user's call must still succeed. */
	onError(err: Error, where: ErrorSite): void;
}

/**
 * Adapter for a single LLM provider / client class. The same shape works for
 * built-in adapters and custom developer-supplied adapters.
 */
export interface Adapter<TClient = unknown> {
	/** Stable, human-readable name, e.g. `"openai"`. */
	name: string;
	/** Return true when this adapter can wrap `client`. */
	matches(client: unknown): client is TClient;
	/** Return a drop-in replacement for `client`. */
	wrap(client: TClient, ctx: WrapContext): TClient;
}

/**
 * The raw event shape we hand to the Chargebee SDK. Mirrors
 * `Chargebee.UsageEvent.EventsBatchIngestInputParam` but kept loose so we don't
 * couple the public surface to a specific SDK version.
 */
export interface PendingUsageEvent {
	deduplication_id: string;
	subscription_id: string;
	usage_timestamp: number;
	properties: Record<string, unknown>;
}
