import {
	type ChargebeeEntitlementsSnapshot,
	type EntitlementResolution,
	errorResolution,
	Feature,
	isSnapshotExpired,
	parseEntitlementsSnapshot,
	resolveEntitlement,
} from "../shared";

export interface ChargebeeEntitlementsWebClientOptions {
	relayUrl: string | URL;
	fetchImplementation?: typeof fetch;
	credentials?: RequestCredentials;
	requestHeaders?: HeadersInit;
	/** The current snapshot has expired and a refresh has started. */
	onStale?: () => void;
	/** A refresh completed with entitlements that differ from the previous snapshot. */
	onConfigurationChanged?: (flagsChanged: string[]) => void;
	onError?: (message: string) => void;
}

const changedFlags = (
	before: ChargebeeEntitlementsSnapshot | undefined,
	after: ChargebeeEntitlementsSnapshot,
) =>
	[
		...new Set([
			...Object.keys(before?.entitlements ?? {}),
			...Object.keys(after.entitlements),
		]),
	].filter(
		(flag) =>
			JSON.stringify(before?.entitlements[flag]) !==
			JSON.stringify(after.entitlements[flag]),
	);

/**
 * Framework-agnostic Chargebee entitlements client for browsers. Fetches a
 * sanitized snapshot from an authenticated relay endpoint (see
 * `@chargebee/entitlements/server` or `@chargebee/entitlements/nextjs`) and
 * evaluates feature IDs against it synchronously. Use this directly, or wrap
 * it with an adapter such as `@chargebee/openfeature`'s
 * `ChargebeeEntitlementsWebProvider`.
 */
export class ChargebeeEntitlementsWebClient {
	private readonly relayUrl: string;
	private readonly fetchImplementation: typeof fetch;
	private readonly credentials: RequestCredentials;
	private readonly requestHeaders?: HeadersInit;
	private readonly onStale?: () => void;
	private readonly onConfigurationChanged?: (flagsChanged: string[]) => void;
	private readonly onError?: (message: string) => void;
	private snapshot?: ChargebeeEntitlementsSnapshot;
	private staleEventEmitted = false;
	private closed = false;
	private refreshInProgress = false;

	constructor(options: ChargebeeEntitlementsWebClientOptions) {
		if (!options?.relayUrl) throw new Error("relayUrl is required");
		this.relayUrl = options.relayUrl.toString();
		this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
		if (!this.fetchImplementation) {
			throw new Error("A fetch implementation is required");
		}
		this.credentials = options.credentials ?? "same-origin";
		this.requestHeaders = options.requestHeaders;
		this.onStale = options.onStale;
		this.onConfigurationChanged = options.onConfigurationChanged;
		this.onError = options.onError;
	}

	async initialize(): Promise<void> {
		this.closed = false;
		await this.loadSnapshot(false);
	}

	/** Clears the current snapshot and reloads it, e.g. after the session's billing subject changes. */
	async reset(): Promise<void> {
		this.snapshot = undefined;
		this.staleEventEmitted = false;
		this.refreshInProgress = false;
		await this.refreshSnapshot();
	}

	async close(): Promise<void> {
		this.closed = true;
		this.snapshot = undefined;
		this.staleEventEmitted = false;
		this.refreshInProgress = false;
	}

	refreshSnapshot(): Promise<void> {
		return this.loadSnapshot(true);
	}

	/**
	 * Resolves a feature into whatever shape `defaultValue` declares, against
	 * the snapshot currently held in memory. The relay scopes that snapshot to
	 * the authenticated session, so there is no target to pass.
	 */
	getValue<T>(featureId: string, defaultValue: T): EntitlementResolution<T> {
		const snapshot = this.getUsableSnapshot(defaultValue);
		return "entitlements" in snapshot
			? resolveEntitlement(snapshot, featureId, defaultValue, "relay")
			: snapshot;
	}

	/**
	 * Declares a feature bound to this web client, evaluated synchronously
	 * against the current relay snapshot.
	 */
	feature<T>(featureId: string, defaultValue: T): Feature<T> {
		return new Feature(featureId, defaultValue, this);
	}

	private getUsableSnapshot<T>(
		defaultValue: T,
	): ChargebeeEntitlementsSnapshot | EntitlementResolution<T> {
		if (!this.snapshot) {
			return errorResolution(
				defaultValue,
				"PROVIDER_NOT_READY",
				"Chargebee entitlement snapshot is not loaded",
			);
		}

		if (!isSnapshotExpired(this.snapshot)) return this.snapshot;

		if (!this.staleEventEmitted) {
			this.onStale?.();
			this.staleEventEmitted = true;
		}

		if (!this.refreshInProgress && !this.closed) {
			this.refreshInProgress = true;
			this.refreshSnapshot()
				.catch(() => {
					// Errors are already handled in loadSnapshot
				})
				.finally(() => {
					this.refreshInProgress = false;
				});
		}

		return { value: defaultValue, reason: "STALE" };
	}

	private async loadSnapshot(emitChange: boolean): Promise<void> {
		if (this.closed) throw new Error("Chargebee web client is closed");

		try {
			const headers = new Headers(this.requestHeaders);
			if (!headers.has("Accept")) headers.set("Accept", "application/json");
			const response = await this.fetchImplementation(this.relayUrl, {
				method: "GET",
				cache: "no-store",
				credentials: this.credentials,
				headers,
			});
			if (!response.ok) {
				throw new Error(
					`Chargebee entitlement relay returned HTTP ${response.status}`,
				);
			}

			const nextSnapshot = parseEntitlementsSnapshot(await response.json());
			const flagsChanged = changedFlags(this.snapshot, nextSnapshot);
			this.snapshot = nextSnapshot;
			this.staleEventEmitted = false;
			if (emitChange && flagsChanged.length > 0) {
				this.onConfigurationChanged?.(flagsChanged);
			}
		} catch (error) {
			if (emitChange) {
				this.onError?.(
					error instanceof Error
						? error.message
						: "Unable to refresh Chargebee entitlements",
				);
			}
			throw error;
		}
	}
}
