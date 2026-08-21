import { createEntitlementsCacheKey, type EntitlementsStorage } from "../cache";
import {
	type ChargebeeEntitlementsSnapshot,
	type ChargebeeEvaluationMode,
	type ChargebeeTarget,
	createEntitlementsSnapshot,
	type EntitlementResolution,
	type EvaluationContextLike,
	errorResolution,
	Feature,
	type FeatureDefinition,
	getTargetFromContext,
	isSnapshotExpired,
	type Logger,
	resolveBooleanEntitlement,
	resolveNumberEntitlement,
	resolveObjectEntitlement,
	resolveStringEntitlement,
	type SnapshotSource,
} from "../shared";
import {
	type ChargebeeEntitlementsClient,
	ChargebeeEntitlementsLoader,
} from "./loader";

/**
 * What happens when neither the cache nor the store holds a snapshot.
 * `blocking` waits for Chargebee; `background` starts the refresh and reports
 * the snapshot as pending so the caller can fall back to its own defaults.
 */
export type RefreshOnMiss = "blocking" | "background";

export type SnapshotOperation =
	| "cache-read"
	| "cache-write"
	| "cache-delete"
	| "store-read"
	| "store-write"
	| "store-delete"
	| "refresh";

export interface SnapshotErrorInfo {
	operation: SnapshotOperation;
	target: ChargebeeTarget;
}

export interface SnapshotRefreshedEvent {
	target: ChargebeeTarget;
	snapshot: ChargebeeEntitlementsSnapshot;
	/** `explicit` for `refreshSnapshot` calls, `request` for request refreshes. */
	trigger: "explicit" | "request";
}

export interface ChargebeeEntitlementsOptions {
	chargebeeClient: ChargebeeEntitlementsClient;
	defaultMode?: ChargebeeEvaluationMode;
	consolidateCustomerEntitlements?: boolean;
	resolveTarget?: (context: EvaluationContextLike) => ChargebeeTarget;
	/** Fast shared cache (Redis or similar) read before the store. */
	cache?: EntitlementsStorage;
	/** Cache expiry. Defaults to whatever the cache implementation applies. */
	cacheTtlMs?: number;
	/** Durable snapshot store treated as the source of truth. */
	store?: EntitlementsStorage;
	cacheNamespace?: string;
	snapshotTtlMs?: number;
	refreshOnMiss?: RefreshOnMiss;
	/** Minimum gap between background refresh attempts after a failure. */
	refreshBackoffMs?: number;
	onSnapshotRefreshed?: (event: SnapshotRefreshedEvent) => void;
	onError?: (error: unknown, info: SnapshotErrorInfo) => void;
	pageSize?: number;
	maxPages?: number;
}

export interface EntitlementsSnapshotResult {
	snapshot: ChargebeeEntitlementsSnapshot;
	source: Exclude<SnapshotSource, "relay">;
}

class InvalidEntitlementContextError extends Error {}

/**
 * Thrown when no snapshot is available locally and the client was configured
 * to refresh in the background instead of blocking on Chargebee.
 */
export class SnapshotPendingError extends Error {
	readonly name = "SnapshotPendingError";

	constructor(readonly target: ChargebeeTarget) {
		super("Chargebee entitlement snapshot is still loading");
	}
}

function isChargebeeTarget(
	target: ChargebeeTarget | EvaluationContextLike,
): target is ChargebeeTarget {
	const candidate = target as Partial<ChargebeeTarget>;
	return candidate.mode === "customer"
		? typeof (candidate as { customerId?: unknown }).customerId === "string"
		: candidate.mode === "subscription"
			? typeof (candidate as { subscriptionId?: unknown }).subscriptionId ===
				"string"
			: false;
}

/**
 * Framework-agnostic Chargebee entitlements client. Resolves a snapshot from
 * a shared cache, a durable store, or the Chargebee API, and evaluates
 * feature IDs against it. Use this directly, or wrap it with an adapter such
 * as `@chargebee/openfeature`'s `ChargebeeEntitlementsProvider`.
 */
export class ChargebeeEntitlements {
	private readonly defaultMode: ChargebeeEvaluationMode;
	private readonly consolidateCustomerEntitlements: boolean;
	private readonly resolveTargetOption?: (
		context: EvaluationContextLike,
	) => ChargebeeTarget;
	private readonly cache?: EntitlementsStorage;
	private readonly cacheTtlMs?: number;
	private readonly store?: EntitlementsStorage;
	private readonly cacheNamespace?: string;
	private readonly snapshotTtlMs: number;
	private readonly refreshOnMiss: RefreshOnMiss;
	private readonly refreshBackoffMs: number;
	private readonly onSnapshotRefreshed?: (
		event: SnapshotRefreshedEvent,
	) => void;
	private readonly onError?: (error: unknown, info: SnapshotErrorInfo) => void;
	private readonly loader: ChargebeeEntitlementsLoader;
	private readonly inFlight = new Map<
		string,
		{ promise: Promise<ChargebeeEntitlementsSnapshot>; cancelled: boolean }
	>();
	private readonly failedAt = new Map<string, number>();

	constructor(options: ChargebeeEntitlementsOptions) {
		if (!options?.chargebeeClient)
			throw new Error("chargebeeClient is required");

		this.defaultMode = options.defaultMode ?? "customer";
		this.consolidateCustomerEntitlements =
			options.consolidateCustomerEntitlements ?? true;
		this.resolveTargetOption = options.resolveTarget;
		this.cache = options.cache;
		this.cacheTtlMs = options.cacheTtlMs;
		this.store = options.store;
		this.cacheNamespace = options.cacheNamespace;
		this.snapshotTtlMs = options.snapshotTtlMs ?? 300_000;
		this.refreshOnMiss = options.refreshOnMiss ?? "blocking";
		this.refreshBackoffMs = options.refreshBackoffMs ?? 10_000;
		this.onSnapshotRefreshed = options.onSnapshotRefreshed;
		this.onError = options.onError;
		for (const [name, value] of [
			["cacheTtlMs", this.cacheTtlMs],
			["snapshotTtlMs", this.snapshotTtlMs],
		] as const) {
			if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
				throw new Error(`${name} must be a positive number`);
			}
		}
		this.loader = new ChargebeeEntitlementsLoader({
			chargebeeClient: options.chargebeeClient,
			consolidateCustomerEntitlements: this.consolidateCustomerEntitlements,
			pageSize: options.pageSize ?? 100,
			maxPages: options.maxPages ?? 50,
		});
	}

	async close(): Promise<void> {
		for (const request of this.inFlight.values()) request.cancelled = true;
		this.inFlight.clear();
		this.failedAt.clear();
	}

	getBooleanValue(
		flagKey: string,
		defaultValue: boolean,
		target: ChargebeeTarget | EvaluationContextLike,
		logger?: Logger,
	): Promise<EntitlementResolution<boolean>> {
		return this.evaluate(defaultValue, target, logger, (result) =>
			resolveBooleanEntitlement(
				result.snapshot,
				flagKey,
				defaultValue,
				result.source,
			),
		);
	}

	getStringValue(
		flagKey: string,
		defaultValue: string,
		target: ChargebeeTarget | EvaluationContextLike,
		logger?: Logger,
	): Promise<EntitlementResolution<string>> {
		return this.evaluate(defaultValue, target, logger, (result) =>
			resolveStringEntitlement(
				result.snapshot,
				flagKey,
				defaultValue,
				result.source,
			),
		);
	}

	getNumberValue(
		flagKey: string,
		defaultValue: number,
		target: ChargebeeTarget | EvaluationContextLike,
		logger?: Logger,
	): Promise<EntitlementResolution<number>> {
		return this.evaluate(defaultValue, target, logger, (result) =>
			resolveNumberEntitlement(
				result.snapshot,
				flagKey,
				defaultValue,
				result.source,
			),
		);
	}

	getObjectValue<T>(
		flagKey: string,
		defaultValue: T,
		target: ChargebeeTarget | EvaluationContextLike,
		logger?: Logger,
	): Promise<EntitlementResolution<T>> {
		return this.evaluate(defaultValue, target, logger, (result) =>
			resolveObjectEntitlement(
				result.snapshot,
				flagKey,
				defaultValue,
				result.source,
			),
		);
	}

	/**
	 * Declares a feature bound to this client, so its value is fetched with a
	 * single concise call:
	 *
	 * ```ts
	 * const seats = entitlements.feature("licensed-seats", {
	 *   type: "number",
	 *   defaultValue: 0,
	 * });
	 *
	 * const value = await seats.get({ mode: "customer", customerId });
	 * ```
	 */
	feature<T>(featureId: string, definition: FeatureDefinition<T>): Feature<T> {
		return new Feature(featureId, { ...definition, client: this });
	}

	/**
	 * Resolves a snapshot from the cache, then the store, then Chargebee.
	 * Throws {@link SnapshotPendingError} when nothing is stored locally and
	 * `refreshOnMiss` is `background`.
	 */
	async getSnapshot(
		target: ChargebeeTarget | EvaluationContextLike,
		logger?: Logger,
	): Promise<EntitlementsSnapshotResult> {
		const resolved = this.resolveTarget(target);
		const key = this.cacheKey(resolved);

		const cached = await this.read(this.cache, key, resolved, "cache-read");
		if (cached) {
			this.refreshIfExpired(cached, resolved, key, logger);
			return { snapshot: cached, source: "cache" };
		}

		const stored = await this.read(this.store, key, resolved, "store-read");
		if (stored) {
			await this.write(this.cache, key, stored, resolved, "cache-write");
			this.refreshIfExpired(stored, resolved, key, logger);
			return { snapshot: stored, source: "store" };
		}

		if (this.refreshOnMiss === "background") {
			this.scheduleRefresh(resolved, key, logger);
			throw new SnapshotPendingError(resolved);
		}

		return {
			snapshot: await this.fetchAndPersistSnapshot(
				resolved,
				key,
				"request",
				logger,
			),
			source: "api",
		};
	}

	/**
	 * Fetches the complete snapshot from Chargebee and writes it to the store
	 * and cache. Use this from webhook workers and reconciliation jobs.
	 *
	 * The cache entry is dropped before the fetch: an explicit refresh means the
	 * truth has changed, so reads fall through to the store rather than serve a
	 * value the caller already knows is stale.
	 */
	async refreshSnapshot(
		target: ChargebeeTarget,
		logger?: Logger,
	): Promise<EntitlementsSnapshotResult> {
		const key = this.cacheKey(target);
		// An explicit refresh represents a known upstream change (typically a
		// webhook). It must not join a request refresh that may have started
		// before that change. Cancel both before and after the async eviction so
		// no refresh started during that gap can be reused either.
		this.cancelInFlight(key);
		await this.evictCache(key, target);
		this.cancelInFlight(key);
		return {
			snapshot: await this.fetchAndPersistSnapshot(
				target,
				key,
				"explicit",
				logger,
			),
			source: "api",
		};
	}

	/** Writes a snapshot assembled elsewhere, e.g. from a webhook payload. */
	async writeSnapshot(
		target: ChargebeeTarget,
		snapshot: ChargebeeEntitlementsSnapshot,
	): Promise<void> {
		if (snapshot.targetMode !== target.mode) {
			throw new Error(
				`Snapshot target mode ${snapshot.targetMode} does not match ${target.mode}`,
			);
		}
		const key = this.cacheKey(target);
		this.cancelInFlight(key);
		await this.persist(key, snapshot, target);
	}

	/** Removes the snapshot from both the cache and the store. */
	async deleteSnapshot(target: ChargebeeTarget): Promise<void> {
		const key = this.cacheKey(target);
		this.cancelInFlight(key);
		await this.evictCache(key, target);
		await this.store?.delete(key);
	}

	/** Drops the cached copy, leaving the store as the next read's source. */
	async evictCachedSnapshot(target: ChargebeeTarget): Promise<void> {
		await this.evictCache(this.cacheKey(target), target);
	}

	async getRelaySnapshot(
		target: ChargebeeTarget | EvaluationContextLike,
		ttlMs = 60_000,
		logger?: Logger,
	): Promise<ChargebeeEntitlementsSnapshot> {
		const { snapshot } = await this.getSnapshot(target, logger);
		return {
			...snapshot,
			expiresAt: new Date(
				Math.min(Date.parse(snapshot.expiresAt), Date.now() + ttlMs),
			).toISOString(),
		};
	}

	private async evaluate<T>(
		defaultValue: T,
		target: ChargebeeTarget | EvaluationContextLike,
		logger: Logger | undefined,
		resolve: (result: EntitlementsSnapshotResult) => EntitlementResolution<T>,
	): Promise<EntitlementResolution<T>> {
		try {
			return resolve(await this.getSnapshot(target, logger));
		} catch (error) {
			if (error instanceof SnapshotPendingError) {
				return {
					value: defaultValue,
					reason: "STALE",
					flagMetadata: { snapshotPending: true },
				};
			}
			return errorResolution(
				defaultValue,
				error instanceof InvalidEntitlementContextError
					? "INVALID_CONTEXT"
					: "GENERAL",
				error instanceof Error
					? error.message
					: "Unable to evaluate Chargebee entitlement",
			);
		}
	}

	private async read(
		storage: EntitlementsStorage | undefined,
		key: string,
		target: ChargebeeTarget,
		operation: Extract<SnapshotOperation, "cache-read" | "store-read">,
	): Promise<ChargebeeEntitlementsSnapshot | undefined> {
		if (!storage) return undefined;
		try {
			return await storage.get(key);
		} catch (error) {
			// A storage outage degrades to the next link in the chain.
			this.onError?.(error, { operation, target });
			return undefined;
		}
	}

	private async write(
		storage: EntitlementsStorage | undefined,
		key: string,
		snapshot: ChargebeeEntitlementsSnapshot,
		target: ChargebeeTarget,
		operation: Extract<SnapshotOperation, "cache-write" | "store-write">,
	): Promise<void> {
		if (!storage) return;
		try {
			await storage.set(
				key,
				snapshot,
				operation === "cache-write" ? this.cacheTtlMs : this.snapshotTtlMs,
			);
		} catch (error) {
			this.onError?.(error, { operation, target });
		}
	}

	private async evictCache(
		key: string,
		target: ChargebeeTarget,
	): Promise<void> {
		if (!this.cache) return;
		try {
			await this.cache.delete(key);
		} catch (error) {
			this.onError?.(error, { operation: "cache-delete", target });
		}
	}

	/**
	 * The store is authoritative, so an expired snapshot is still served while
	 * a fresh copy loads in the background.
	 */
	private refreshIfExpired(
		snapshot: ChargebeeEntitlementsSnapshot,
		target: ChargebeeTarget,
		key: string,
		logger?: Logger,
	): void {
		if (isSnapshotExpired(snapshot)) this.scheduleRefresh(target, key, logger);
	}

	private scheduleRefresh(
		target: ChargebeeTarget,
		key: string,
		logger?: Logger,
	): void {
		const failedAt = this.failedAt.get(key);
		if (failedAt !== undefined && Date.now() - failedAt < this.refreshBackoffMs)
			return;

		void this.fetchAndPersistSnapshot(target, key, "request", logger).catch(
			() => {
				// Reported through onError inside fetchAndPersistSnapshot.
			},
		);
	}

	private fetchAndPersistSnapshot(
		target: ChargebeeTarget,
		key: string,
		trigger: SnapshotRefreshedEvent["trigger"],
		logger?: Logger,
	): Promise<ChargebeeEntitlementsSnapshot> {
		const current = this.inFlight.get(key);
		if (current) return current.promise;

		const request = {
			cancelled: false,
			promise: Promise.resolve().then(async () => {
				try {
					const snapshot = createEntitlementsSnapshot(
						target.mode,
						await this.loader.load(target, logger),
						this.snapshotTtlMs,
					);
					if (!request.cancelled) {
						await this.persist(key, snapshot, target);
						this.onSnapshotRefreshed?.({ target, snapshot, trigger });
					}
					this.failedAt.delete(key);
					return snapshot;
				} catch (error) {
					this.failedAt.set(key, Date.now());
					this.onError?.(error, { operation: "refresh", target });
					throw error;
				} finally {
					if (this.inFlight.get(key) === request) this.inFlight.delete(key);
				}
			}),
		};
		this.inFlight.set(key, request);
		return request.promise;
	}

	/** The store is the source of truth, so its write failures propagate. */
	private async persist(
		key: string,
		snapshot: ChargebeeEntitlementsSnapshot,
		target: ChargebeeTarget,
	): Promise<void> {
		if (this.store) await this.store.set(key, snapshot, this.snapshotTtlMs);
		await this.write(this.cache, key, snapshot, target, "cache-write");
	}

	private cancelInFlight(key: string): void {
		const current = this.inFlight.get(key);
		if (current) current.cancelled = true;
		this.inFlight.delete(key);
	}

	private resolveTarget(
		target: ChargebeeTarget | EvaluationContextLike,
	): ChargebeeTarget {
		if (isChargebeeTarget(target)) return target;
		try {
			return this.resolveTargetOption
				? this.resolveTargetOption(target)
				: getTargetFromContext(target, this.defaultMode);
		} catch (error) {
			throw new InvalidEntitlementContextError(
				error instanceof Error ? error.message : "Invalid evaluation context",
			);
		}
	}

	private cacheKey(target: ChargebeeTarget): string {
		return createEntitlementsCacheKey(target, {
			namespace: this.cacheNamespace,
			consolidateCustomerEntitlements: this.consolidateCustomerEntitlements,
		});
	}
}

export type { ChargebeeEntitlementsClient };
