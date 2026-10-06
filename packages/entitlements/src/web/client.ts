import {
	type ChargebeeEntitlementsSnapshot,
	type EntitlementDetails,
	Feature,
	isSnapshotExpired,
	parseEntitlementsSnapshot,
	resolveEntitlement,
	type ScopedEntitlementsClient,
} from "../shared";

export interface SnapshotErrorInfo {
	operation: "refresh";
}

export interface SnapshotRefreshedEvent {
	snapshot: ChargebeeEntitlementsSnapshot;
	/** Features whose entitlement differs from the previous snapshot. */
	changedFeatureIds: string[];
}

export interface ChargebeeEntitlementsOptions {
	relayUrl: string | URL;
	fetchImplementation?: typeof fetch;
	credentials?: RequestCredentials;
	requestHeaders?: HeadersInit;
	/** The current snapshot has expired and a refresh has started. */
	onSnapshotExpired?: () => void;
	/** A refresh (not the initial load) completed. */
	onSnapshotRefreshed?: (event: SnapshotRefreshedEvent) => void;
	onError?: (error: unknown, info: SnapshotErrorInfo) => void;
}

/**
 * `initial` loads come from `initialize` and report nothing; `refresh` loads
 * report through `onSnapshotRefreshed` and `onError`.
 */
type LoadKind = "initial" | "refresh";

const changedFeatures = (
	before: ChargebeeEntitlementsSnapshot | undefined,
	after: ChargebeeEntitlementsSnapshot,
) =>
	[
		...new Set([
			...Object.keys(before?.entitlements ?? {}),
			...Object.keys(after.entitlements),
		]),
	].filter(
		(featureId) =>
			JSON.stringify(before?.entitlements[featureId]) !==
			JSON.stringify(after.entitlements[featureId]),
	);

/**
 * Framework-agnostic Chargebee entitlements client for browsers. Fetches a
 * sanitized snapshot from an authenticated relay endpoint (see
 * `@chargebee/entitlements/server` or `@chargebee/entitlements/nextjs`) and
 * evaluates feature IDs against it synchronously.
 */
export class ChargebeeEntitlements {
	private readonly relayUrl: string;
	private readonly fetchImplementation: typeof fetch;
	private readonly credentials: RequestCredentials;
	private readonly requestHeaders?: HeadersInit;
	private readonly onSnapshotExpired?: () => void;
	private readonly onSnapshotRefreshed?: (
		event: SnapshotRefreshedEvent,
	) => void;
	private readonly onError?: (error: unknown, info: SnapshotErrorInfo) => void;
	private snapshot?: ChargebeeEntitlementsSnapshot;
	private expiryReported = false;
	private closed = false;
	private refreshInProgress = false;
	private loads = new AbortController();

	constructor(options: ChargebeeEntitlementsOptions) {
		if (!options?.relayUrl) throw new Error("relayUrl is required");
		this.relayUrl = options.relayUrl.toString();
		this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
		if (!this.fetchImplementation) {
			throw new Error("A fetch implementation is required");
		}
		this.credentials = options.credentials ?? "same-origin";
		this.requestHeaders = options.requestHeaders;
		this.onSnapshotExpired = options.onSnapshotExpired;
		this.onSnapshotRefreshed = options.onSnapshotRefreshed;
		this.onError = options.onError;
	}

	async initialize(): Promise<void> {
		this.closed = false;
		await this.loadSnapshot("initial");
	}

	/** Clears the current snapshot and reloads it, e.g. after the session's billing subject changes. */
	async reset(): Promise<void> {
		this.supersedeLoads();
		this.snapshot = undefined;
		this.expiryReported = false;
		this.refreshInProgress = false;
		await this.refreshSnapshot();
	}

	async close(): Promise<void> {
		this.supersedeLoads();
		this.closed = true;
		this.snapshot = undefined;
		this.expiryReported = false;
		this.refreshInProgress = false;
	}

	refreshSnapshot(): Promise<void> {
		return this.loadSnapshot("refresh");
	}

	/**
	 * Resolves a feature into whatever shape `defaultValue` declares, against
	 * the snapshot currently held in memory. The relay scopes that snapshot to
	 * the authenticated session, so there is no target to pass.
	 */
	get<T>(featureId: string, defaultValue: T): T {
		return this.getDetails(featureId, defaultValue).value;
	}

	/** Like {@link get}, but returns the status and entitlement behind the value. */
	getDetails<T>(featureId: string, defaultValue: T): EntitlementDetails<T> {
		if (!this.snapshot) {
			return { value: defaultValue, status: "pending" };
		}

		if (isSnapshotExpired(this.snapshot)) {
			this.refreshExpired();
			return { value: defaultValue, status: "stale" };
		}

		return resolveEntitlement(this.snapshot, featureId, defaultValue, "relay");
	}

	/**
	 * Declares a feature bound to this client, evaluated synchronously against
	 * the current relay snapshot.
	 */
	feature<T>(
		featureId: string,
		defaultValue: T,
	): Feature<T, ScopedEntitlementsClient> {
		return new Feature<T, ScopedEntitlementsClient>(
			featureId,
			defaultValue,
			this,
		);
	}

	/** Reports the expiry once and starts a single background refresh. */
	private refreshExpired(): void {
		if (!this.expiryReported) {
			this.onSnapshotExpired?.();
			this.expiryReported = true;
		}

		if (this.refreshInProgress || this.closed) {
			return;
		}

		this.refreshInProgress = true;
		this.refreshSnapshot()
			.catch(() => {
				// Reported through onError inside loadSnapshot.
			})
			.finally(() => {
				this.refreshInProgress = false;
			});
	}

	/**
	 * Aborts loads started before a `reset` or `close`, so a late response for
	 * the previous session cannot overwrite (or resurrect) the snapshot.
	 */
	private supersedeLoads(): void {
		this.loads.abort();
		this.loads = new AbortController();
	}

	private async loadSnapshot(kind: LoadKind): Promise<void> {
		if (this.closed) throw new Error("Chargebee web client is closed");

		const { signal } = this.loads;
		try {
			const headers = new Headers(this.requestHeaders);
			if (!headers.has("Accept")) headers.set("Accept", "application/json");
			const response = await this.fetchImplementation(this.relayUrl, {
				method: "GET",
				cache: "no-store",
				credentials: this.credentials,
				headers,
				signal,
			});
			if (!response.ok) {
				throw new Error(
					`Chargebee entitlement relay returned HTTP ${response.status}`,
				);
			}

			const nextSnapshot = parseEntitlementsSnapshot(await response.json());
			if (signal.aborted) {
				return;
			}

			const changedFeatureIds = changedFeatures(this.snapshot, nextSnapshot);
			this.snapshot = nextSnapshot;

			// An already-expired snapshot is still stale; report it once.
			if (!isSnapshotExpired(nextSnapshot)) {
				this.expiryReported = false;
			}

			if (kind === "refresh") {
				this.onSnapshotRefreshed?.({
					snapshot: nextSnapshot,
					changedFeatureIds,
				});
			}
		} catch (error) {
			if (signal.aborted) {
				return;
			}

			if (kind === "refresh") {
				this.onError?.(error, { operation: "refresh" });
			}
			throw error;
		}
	}
}
