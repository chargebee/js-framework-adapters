import { BUILT_IN_ADAPTERS } from "./adapters/index.js";
import {
	type AlertHandlers,
	type AlertWebhookEvent,
	dispatchAlertWebhook,
	parseAlertWebhook,
} from "./alerts.js";
import { Batcher } from "./batcher.js";
import { ContextStore } from "./context.js";
import { deduplicationId } from "./dedup.js";
import { CHARGEBEE_BATCH_CEILING, ChargebeeEmitter } from "./emitter.js";
import { defaultOnError, toError } from "./errors.js";
import {
	type Adapter,
	type CallContext,
	type CanonicalUsage,
	type CanonicalUsageField,
	DEFAULT_METRIC_MAPPING,
	type ErrorSite,
	type EventProperties,
	type FlushMode,
	type MeterOptions,
	type PendingUsageEvent,
	type ResolvedContext,
	type WrapContext,
} from "./types.js";
import {
	type GetUsageSummaryInput,
	UsageSummaryClient,
	type UsageSummaryPage,
} from "./usage-summary.js";

const DEFAULTS = {
	flushIntervalMs: 1_000,
	maxBatchSize: 100,
	maxBufferSize: 10_000,
	maxRetryMs: 60_000,
	flushMode: "background" as FlushMode,
};

/**
 * The single entry point for `@chargebee/usage-meter`. Wrap your LLM client
 * with `meter.wrap(client)` and usage events stream to Chargebee in the
 * background.
 *
 * @example
 * ```ts
 * const meter = new UsageMeter({ chargebee, defaultSubscriptionId: "sub_42" });
 * const openai = meter.wrap(new OpenAI());
 * ```
 */
export class UsageMeter {
	private readonly adapters: Adapter[] = [];
	private readonly batcher: Batcher;
	private readonly contextStore = new ContextStore();
	private readonly metricMapping: Record<CanonicalUsageField, string>;
	private readonly defaultProperties: EventProperties;
	private readonly defaultSubscriptionId?: string;
	private readonly flushMode: FlushMode;
	private readonly onError: (err: Error, where: ErrorSite) => void;
	private readonly wrapCtx: WrapContext;
	private readonly summaryClient: UsageSummaryClient;

	constructor(opts: MeterOptions) {
		if (!opts || !opts.chargebee) {
			throw new Error(
				"UsageMeter: `chargebee` (a pre-built Chargebee client) is required",
			);
		}

		this.onError = opts.onError ?? defaultOnError;
		this.defaultSubscriptionId = opts.defaultSubscriptionId;
		this.defaultProperties = opts.defaultProperties ?? {};
		this.metricMapping = {
			...DEFAULT_METRIC_MAPPING,
			...(opts.metricMapping ?? {}),
		};
		this.flushMode = opts.flushMode ?? detectFlushMode(DEFAULTS.flushMode);

		const emitter = new ChargebeeEmitter(opts.chargebee, this.onError);
		this.summaryClient = new UsageSummaryClient(opts.chargebee, this.onError);
		this.batcher = new Batcher(emitter, {
			flushIntervalMs: opts.flushIntervalMs ?? DEFAULTS.flushIntervalMs,
			maxBatchSize: Math.min(
				opts.maxBatchSize ?? DEFAULTS.maxBatchSize,
				CHARGEBEE_BATCH_CEILING,
			),
			maxBufferSize: opts.maxBufferSize ?? DEFAULTS.maxBufferSize,
			maxRetryMs: opts.maxRetryMs ?? DEFAULTS.maxRetryMs,
			onError: this.onError,
		});
		if (this.flushMode === "background") {
			this.batcher.start();
		}

		this.wrapCtx = {
			record: (usage, callContext) => this.record(usage, callContext),
			onError: (err, where) => this.onError(err, where),
		};

		for (const adapter of BUILT_IN_ADAPTERS) {
			this.adapters.push(adapter);
		}
	}

	/**
	 * Register an adapter for a custom LLM client. Returns the meter for
	 * chaining. Adapters are matched in registration order (last-registered
	 * wins on tie, falling back to built-ins for unknown clients).
	 */
	registerAdapter<T>(adapter: Adapter<T>): this {
		this.adapters.unshift(adapter as Adapter);
		return this;
	}

	/**
	 * Return a drop-in replacement for `client` that ships token usage to
	 * Chargebee on every call. Throws if no registered adapter matches.
	 */
	wrap<T extends object>(client: T): T {
		for (const adapter of this.adapters) {
			if (adapter.matches(client)) {
				try {
					return adapter.wrap(client, this.wrapCtx) as T;
				} catch (err) {
					this.onError(toError(err), "wrap");
					return client;
				}
			}
		}
		throw new Error(
			`UsageMeter.wrap: no adapter matches the provided client. ` +
				`Register one via meter.registerAdapter(...)`,
		);
	}

	/**
	 * Run `fn` with the given call context applied. All LLM calls made
	 * (transitively) inside `fn` will use this context unless overridden by a
	 * more-specific per-call value.
	 */
	withContext<R>(ctx: CallContext, fn: () => R): R {
		return this.contextStore.run(ctx, fn);
	}

	/** Convenience wrapper around {@link withContext} for the common case. */
	withSubscription<R>(subscriptionId: string, fn: () => R): R {
		return this.contextStore.run({ subscriptionId }, fn);
	}

	/** Force-flush the buffer. Resolves once Chargebee acknowledges. */
	async flush(): Promise<void> {
		await this.batcher.flush();
	}

	/** Stop the background timer and drain the buffer. Call on `SIGTERM`. */
	async shutdown(): Promise<void> {
		try {
			await this.batcher.flush();
		} catch (err) {
			this.onError(toError(err), "shutdown");
		}
		this.batcher.stop();
	}

	/** Buffered (un-flushed) event count. Exposed for tests and observability. */
	pendingCount(): number {
		return this.batcher.bufferedCount();
	}

	/**
	 * Fetch pre-aggregated usage for a subscription / feature pair. Thin
	 * wrapper around `chargebee.usageSummary.retrieveUsageSummaryForSubscription`.
	 *
	 * Use this for in-app dashboards, pre-flight quota checks, or "show the
	 * user how much they've used this cycle" widgets without rolling your own
	 * aggregation.
	 *
	 * @example
	 * ```ts
	 * const { items } = await meter.getUsageSummary({
	 *   subscriptionId: "sub_acme",
	 *   featureId: "feat_llm_tokens",
	 *   windowSize: "month",
	 * });
	 * ```
	 */
	async getUsageSummary(
		input: GetUsageSummaryInput,
	): Promise<UsageSummaryPage> {
		return this.summaryClient.get(input);
	}

	/**
	 * Parse a Chargebee webhook payload as an `alert_status_changed` event.
	 * Returns `null` for any other event type — safe to call on every webhook.
	 */
	parseAlertWebhook(payload: unknown): AlertWebhookEvent | null {
		return parseAlertWebhook(payload);
	}

	/**
	 * Dispatch a Chargebee webhook to the right alert handler. Wire this into
	 * your `/webhooks/chargebee` endpoint:
	 *
	 * @example
	 * ```ts
	 * app.post("/webhooks/chargebee", express.json(), async (req, res) => {
	 *   await meter.handleAlertWebhook(req.body, {
	 *     onAlarmTriggered: async (event) => disableTenant(event.subscriptionId),
	 *     onAlarmCleared:   async (event) => enableTenant(event.subscriptionId),
	 *   });
	 *   res.status(200).end();
	 * });
	 * ```
	 *
	 * @returns the parsed event when handled, `null` for non-alert webhooks.
	 *          Handler errors propagate so Chargebee retries the delivery.
	 */
	async handleAlertWebhook(
		payload: unknown,
		handlers: AlertHandlers,
	): Promise<AlertWebhookEvent | null> {
		return dispatchAlertWebhook(payload, handlers, this.onError);
	}

	/**
	 * Internal recorder used by integrations that sit outside the
	 * `wrap()` → adapter pipeline (e.g. the Vercel AI SDK middleware). Public
	 * adapter authors should call `ctx.record` from {@link WrapContext} instead.
	 *
	 * @internal
	 */
	__record(usage: Partial<CanonicalUsage>, callContext?: CallContext): void {
		this.record(usage, callContext);
	}

	private record(
		usage: Partial<CanonicalUsage>,
		callContext: CallContext | undefined,
	): void {
		const resolved = this.resolveContext(callContext);
		const properties = this.buildProperties(usage, resolved);
		const event: PendingUsageEvent = {
			deduplication_id: deduplicationId(resolved.requestId),
			subscription_id: resolved.subscriptionId,
			usage_timestamp: resolved.usageTimestampMs,
			properties,
		};
		this.batcher.enqueue(event);
		if (this.flushMode === "onCall") {
			void this.batcher.flush();
		}
	}

	private resolveContext(perCall?: CallContext): ResolvedContext {
		const ctx = this.contextStore.get();
		const subscriptionId =
			perCall?.subscriptionId ??
			ctx?.subscriptionId ??
			this.defaultSubscriptionId;
		if (!subscriptionId) {
			throw new Error(
				"UsageMeter.record: no subscription resolved. " +
					"Set `defaultSubscriptionId`, or wrap the call in " +
					"`meter.withSubscription(...)` / `meter.withContext({ subscriptionId })`.",
			);
		}
		const properties: EventProperties = {
			...(ctx?.properties ?? {}),
			...(perCall?.properties ?? {}),
		};
		const usageTimestampMs =
			perCall?.usageTimestampMs ?? ctx?.usageTimestampMs ?? Date.now();
		const requestId = perCall?.requestId ?? ctx?.requestId ?? "";
		return { subscriptionId, properties, usageTimestampMs, requestId };
	}

	private buildProperties(
		usage: Partial<CanonicalUsage>,
		resolved: ResolvedContext,
	): Record<string, unknown> {
		const out: Record<string, unknown> = { ...this.defaultProperties };
		for (const [key, value] of Object.entries(resolved.properties)) {
			if (value !== undefined) out[key] = value;
		}
		for (const field of Object.keys(usage) as CanonicalUsageField[]) {
			const value = usage[field];
			if (typeof value !== "number" || value <= 0) continue;
			const propertyKey = this.metricMapping[field];
			out[propertyKey] = value;
		}
		return out;
	}
}

/**
 * In edge-style runtimes there's no long-lived process to host a `setInterval`
 * flusher. Detect those environments and default to `"onCall"` so events still
 * get delivered. Best-effort: callers can always override via `MeterOptions`.
 */
function detectFlushMode(fallback: FlushMode): FlushMode {
	const g = globalThis as {
		EdgeRuntime?: unknown;
		WebSocketPair?: unknown;
		Deno?: unknown;
	};
	if (typeof g.EdgeRuntime !== "undefined") return "onCall";
	if (typeof g.WebSocketPair !== "undefined") return "onCall";
	return fallback;
}
