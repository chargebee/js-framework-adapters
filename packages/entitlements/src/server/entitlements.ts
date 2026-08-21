import { createEntitlementsCacheKey, type EntitlementsStorage } from "../cache";
import {
	assertTarget,
	type ChargebeeEntitlementsSnapshot,
	type ChargebeeTarget,
	createEntitlementsSnapshot,
	type EntitlementResolution,
	errorResolution,
	Feature,
	isSnapshotExpired,
	type Logger,
	resolveEntitlement,
	type SnapshotSource,
} from "../shared";
import {
	type ChargebeeEntitlementsClient,
	ChargebeeEntitlementsLoader,
} from "./loader";

type SnapshotOperation =
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
	/** Fast shared cache (Redis or similar) read before the durable store. */
	cache?: EntitlementsStorage;
	/** Cache expiry. Defaults to whatever the cache implementation applies. */
	cacheTtlMs?: number;
	/** Durable snapshot store treated as the source of truth. */
	durableStore?: EntitlementsStorage;
	/** How long a snapshot is valid before it is considered expired. Defaults to 300 000 ms. */
	snapshotTtlMs?: number;
	/**
	 * What happens when neither the cache nor the store holds a snapshot.
	 * `blocking` waits for Chargebee; `background` starts the refresh and
	 * reports the snapshot as pending so callers fall back to their defaults.
	 */
	refreshOnMiss?: "blocking" | "background";
	logger?: Logger;
	onSnapshotRefreshed?: (event: SnapshotRefreshedEvent) => void;
	onError?: (error: unknown, info: SnapshotErrorInfo) => void;
	/** Rarely-needed options. */
	advanced?: {
		cacheNamespace?: string;
		consolidateCustomerEntitlements?: boolean;
		/** Minimum gap between background refresh attempts after a failure. */
		refreshBackoffMs?: number;
		pageSize?: number;
		maxPages?: number;
	};
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

/**
 * Framework-agnostic Chargebee entitlements client. Resolves a snapshot from
 * a shared cache, a durable store, or the Chargebee API, and evaluates
 * feature IDs against it. Use this directly, or wrap it with an adapter such
 * as `@chargebee/openfeature`'s `ChargebeeEntitlementsProvider`.
 */
export class ChargebeeEntitlements {
	private readonly consolidateCustomerEntitlements: boolean;
	private readonly cache?: EntitlementsStorage;
	private readonly cacheTtlMs?: number;
	private readonly durableStore?: EntitlementsStorage;
	private readonly cacheNamespace?: string;
	private readonly snapshotTtlMs: number;
	private readonly refreshOnMiss: "blocking" | "background";
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

		this.consolidateCustomerEntitlements =
			options.advanced?.consolidateCustomerEntitlements ?? true;
		this.cache = options.cache;
		this.cacheTtlMs = options.cacheTtlMs;
		this.durableStore = options.durableStore;
		this.cacheNamespace = options.advanced?.cacheNamespace;
		this.snapshotTtlMs = options.snapshotTtlMs ?? 300_000;
		this.refreshOnMiss = options.refreshOnMiss ?? "blocking";
		this.refreshBackoffMs = options.advanced?.refreshBackoffMs ?? 10_000;
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
			pageSize: options.advanced?.pageSize ?? 100,
			maxPages: options.advanced?.maxPages ?? 50,
			logger: options.logger,
		});
	}

	async close(): Promise<void> {
		for (const request of this.inFlight.values()) request.cancelled = true;
		this.inFlight.clear();
		this.failedAt.clear();
	}

	/**
	 * Resolves a feature into whatever shape `defaultValue` declares, and falls
	 * back to that default when Chargebee has no usable value.
	 */
	getValue<T>(
		featureId: string,
		defaultValue: T,
		target: ChargebeeTarget,
	): Promise<EntitlementResolution<T>> {
		return this.evaluate(defaultValue, target, (result) =>
			resolveEntitlement(
				result.snapshot,
				featureId,
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
	 * const seats = entitlements.feature("licensed-seats", 0);
	 *
	 * const count = await seats.get({ customerId });
	 * ```
	 */
	feature<T>(featureId: string, defaultValue: T): Feature<T> {
		return new Feature(featureId, defaultValue, this);
	}

	/**
	 * Resolves a snapshot from the cache, then the store, then Chargebee.
	 * Throws {@link SnapshotPendingError} when nothing is stored locally and
	 * `refreshOnMiss` is `background`.
	 */
	async getSnapshot(
		target: ChargebeeTarget,
	): Promise<EntitlementsSnapshotResult> {
		const resolved = this.resolveTarget(target);
		const key = this.cacheKey(resolved);

		const cached = await this.read(this.cache, key, resolved, "cache-read");
		if (cached) {
			this.refreshIfExpired(cached, resolved, key);
			return { snapshot: cached, source: "cache" };
		}

		const stored = await this.read(
			this.durableStore,
			key,
			resolved,
			"store-read",
		);
		if (stored) {
			await this.write(this.cache, key, stored, resolved, "cache-write");
			this.refreshIfExpired(stored, resolved, key);
			return { snapshot: stored, source: "store" };
		}

		if (this.refreshOnMiss === "background") {
			this.scheduleRefresh(resolved, key);
			throw new SnapshotPendingError(resolved);
		}

		return {
			snapshot: await this.fetchAndPersistSnapshot(resolved, key, "request"),
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
	): Promise<EntitlementsSnapshotResult> {
		const resolved = this.resolveTarget(target);
		const key = this.cacheKey(resolved);
		// An explicit refresh represents a known upstream change (typically a
		// webhook). It must not join a request refresh that may have started
		// before that change. Cancel both before and after the async eviction so
		// no refresh started during that gap can be reused either.
		this.cancelInFlight(key);
		await this.evictCache(key, resolved);
		this.cancelInFlight(key);
		return {
			snapshot: await this.fetchAndPersistSnapshot(resolved, key, "explicit"),
			source: "api",
		};
	}

	/** Writes a snapshot assembled elsewhere, e.g. from a webhook payload. */
	async writeSnapshot(
		target: ChargebeeTarget,
		snapshot: ChargebeeEntitlementsSnapshot,
	): Promise<void> {
		const resolved = this.resolveTarget(target);
		const key = this.cacheKey(resolved);
		this.cancelInFlight(key);
		await this.persist(key, snapshot, resolved);
	}

	/** Removes the snapshot from both the cache and the durable store. */
	async deleteSnapshot(target: ChargebeeTarget): Promise<void> {
		const resolved = this.resolveTarget(target);
		const key = this.cacheKey(resolved);
		this.cancelInFlight(key);
		await this.evictCache(key, resolved);
		await this.durableStore?.delete(key);
	}

	async getRelaySnapshot(
		target: ChargebeeTarget,
		ttlMs = 60_000,
	): Promise<ChargebeeEntitlementsSnapshot> {
		const { snapshot } = await this.getSnapshot(target);
		return {
			...snapshot,
			expiresAt: new Date(
				Math.min(Date.parse(snapshot.expiresAt), Date.now() + ttlMs),
			).toISOString(),
		};
	}

	private async evaluate<T>(
		defaultValue: T,
		target: ChargebeeTarget,
		resolve: (result: EntitlementsSnapshotResult) => EntitlementResolution<T>,
	): Promise<EntitlementResolution<T>> {
		try {
			return resolve(await this.getSnapshot(target));
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

	private safeStorageOp<T>(
		storage: EntitlementsStorage | undefined,
		operation: SnapshotOperation,
		target: ChargebeeTarget,
		action: (store: EntitlementsStorage) => Promise<T>,
	): Promise<T | undefined> {
		if (!storage) return Promise.resolve(undefined);
		return action(storage).catch((error) => {
			this.onError?.(error, { operation, target });
			return undefined;
		});
	}

	private read(
		storage: EntitlementsStorage | undefined,
		key: string,
		target: ChargebeeTarget,
		operation: Extract<SnapshotOperation, "cache-read" | "store-read">,
	): Promise<ChargebeeEntitlementsSnapshot | undefined> {
		return this.safeStorageOp(storage, operation, target, (store) =>
			store.get(key),
		);
	}

	private async write(
		storage: EntitlementsStorage | undefined,
		key: string,
		snapshot: ChargebeeEntitlementsSnapshot,
		target: ChargebeeTarget,
		operation: Extract<SnapshotOperation, "cache-write" | "store-write">,
	): Promise<void> {
		await this.safeStorageOp(storage, operation, target, (store) =>
			store.set(
				key,
				snapshot,
				operation === "cache-write" ? this.cacheTtlMs : this.snapshotTtlMs,
			),
		);
	}

	private async evictCache(
		key: string,
		target: ChargebeeTarget,
	): Promise<void> {
		await this.safeStorageOp(this.cache, "cache-delete", target, (store) =>
			store.delete(key),
		);
	}

	/**
	 * The store is authoritative, so an expired snapshot is still served while
	 * a fresh copy loads in the background.
	 */
	private refreshIfExpired(
		snapshot: ChargebeeEntitlementsSnapshot,
		target: ChargebeeTarget,
		key: string,
	): void {
		if (isSnapshotExpired(snapshot)) this.scheduleRefresh(target, key);
	}

	private scheduleRefresh(target: ChargebeeTarget, key: string): void {
		const failedAt = this.failedAt.get(key);
		if (failedAt !== undefined && Date.now() - failedAt < this.refreshBackoffMs)
			return;

		void this.fetchAndPersistSnapshot(target, key, "request").catch(() => {
			// Reported through onError inside fetchAndPersistSnapshot.
		});
	}

	private fetchAndPersistSnapshot(
		target: ChargebeeTarget,
		key: string,
		trigger: SnapshotRefreshedEvent["trigger"],
	): Promise<ChargebeeEntitlementsSnapshot> {
		const current = this.inFlight.get(key);
		if (current) return current.promise;

		const request = {
			cancelled: false,
			promise: Promise.resolve().then(async () => {
				try {
					const snapshot = createEntitlementsSnapshot(
						await this.loader.load(target),
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

	/** The durable store is the source of truth, so its write failures propagate. */
	private async persist(
		key: string,
		snapshot: ChargebeeEntitlementsSnapshot,
		target: ChargebeeTarget,
	): Promise<void> {
		if (this.durableStore)
			await this.durableStore.set(key, snapshot, this.snapshotTtlMs);
		await this.write(this.cache, key, snapshot, target, "cache-write");
	}

	private cancelInFlight(key: string): void {
		const current = this.inFlight.get(key);
		if (current) current.cancelled = true;
		this.inFlight.delete(key);
	}

	private resolveTarget(target: ChargebeeTarget): ChargebeeTarget {
		try {
			return assertTarget(target);
		} catch (error) {
			throw new InvalidEntitlementContextError(
				error instanceof Error ? error.message : "Invalid Chargebee target",
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
