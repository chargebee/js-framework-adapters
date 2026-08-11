import {
	type ErrorCode,
	type EvaluationContext,
	type JsonValue,
	type Logger,
	OpenFeatureEventEmitter,
	type Provider,
	ProviderEvents,
	type ResolutionDetails,
} from "@openfeature/web-sdk";
import {
	type ChargebeeEntitlementsSnapshot,
	type EntitlementResolution,
	isSnapshotExpired,
	parseEntitlementsSnapshot,
	resolveBooleanEntitlement,
	resolveNumberEntitlement,
	resolveObjectEntitlement,
	resolveStringEntitlement,
} from "../shared";

export interface ChargebeeEntitlementsWebProviderOptions {
	relayUrl: string | URL;
	fetchImplementation?: typeof fetch;
	credentials?: RequestCredentials;
	requestHeaders?: HeadersInit;
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

export class ChargebeeEntitlementsWebProvider implements Provider {
	readonly metadata = { name: "Chargebee Entitlements" } as const;
	readonly runsOn = "client" as const;
	readonly events = new OpenFeatureEventEmitter();

	private readonly relayUrl: string;
	private readonly fetchImplementation: typeof fetch;
	private readonly credentials: RequestCredentials;
	private readonly requestHeaders?: HeadersInit;
	private snapshot?: ChargebeeEntitlementsSnapshot;
	private staleEventEmitted = false;
	private closed = false;
	private refreshInProgress = false;

	constructor(options: ChargebeeEntitlementsWebProviderOptions) {
		if (!options?.relayUrl) throw new Error("relayUrl is required");
		this.relayUrl = options.relayUrl.toString();
		this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
		if (!this.fetchImplementation) {
			throw new Error("A fetch implementation is required");
		}
		this.credentials = options.credentials ?? "same-origin";
		this.requestHeaders = options.requestHeaders;
	}

	async initialize(): Promise<void> {
		this.closed = false;
		await this.loadSnapshot(false);
	}

	async onContextChange(
		_oldContext: EvaluationContext,
		_newContext: EvaluationContext,
	): Promise<void> {
		// A new session may represent a different billing subject.
		this.snapshot = undefined;
		this.staleEventEmitted = false;
		this.refreshInProgress = false;
		await this.refreshSnapshot();
	}

	async onClose(): Promise<void> {
		this.closed = true;
		this.snapshot = undefined;
		this.staleEventEmitted = false;
		this.refreshInProgress = false;
	}

	refreshSnapshot(): Promise<void> {
		return this.loadSnapshot(true);
	}

	resolveBooleanEvaluation(
		flagKey: string,
		defaultValue: boolean,
		_context: EvaluationContext,
		_logger: Logger,
	): ResolutionDetails<boolean> {
		return this.evaluate(defaultValue, (snapshot) =>
			resolveBooleanEntitlement(snapshot, flagKey, defaultValue, "relay"),
		);
	}

	resolveStringEvaluation(
		flagKey: string,
		defaultValue: string,
		_context: EvaluationContext,
		_logger: Logger,
	): ResolutionDetails<string> {
		return this.evaluate(defaultValue, (snapshot) =>
			resolveStringEntitlement(snapshot, flagKey, defaultValue, "relay"),
		);
	}

	resolveNumberEvaluation(
		flagKey: string,
		defaultValue: number,
		_context: EvaluationContext,
		_logger: Logger,
	): ResolutionDetails<number> {
		return this.evaluate(defaultValue, (snapshot) =>
			resolveNumberEntitlement(snapshot, flagKey, defaultValue, "relay"),
		);
	}

	resolveObjectEvaluation<T extends JsonValue>(
		flagKey: string,
		defaultValue: T,
		_context: EvaluationContext,
		_logger: Logger,
	): ResolutionDetails<T> {
		return this.evaluate(defaultValue, (snapshot) =>
			resolveObjectEntitlement(snapshot, flagKey, defaultValue, "relay"),
		);
	}

	private evaluate<T>(
		defaultValue: T,
		resolve: (
			snapshot: ChargebeeEntitlementsSnapshot,
		) => EntitlementResolution<T>,
	): ResolutionDetails<T> {
		const snapshot = this.getUsableSnapshot(defaultValue);
		return "entitlements" in snapshot
			? this.toResolution(resolve(snapshot))
			: snapshot;
	}

	private getUsableSnapshot<T>(
		defaultValue: T,
	): ChargebeeEntitlementsSnapshot | ResolutionDetails<T> {
		if (!this.snapshot) {
			return {
				value: defaultValue,
				reason: "ERROR",
				errorCode: "PROVIDER_NOT_READY" as ErrorCode,
				errorMessage: "Chargebee entitlement snapshot is not loaded",
			};
		}

		if (!isSnapshotExpired(this.snapshot)) return this.snapshot;

		if (!this.staleEventEmitted) {
			this.events.emit(ProviderEvents.Stale, {
				message: "Chargebee entitlement snapshot expired",
			});
			this.staleEventEmitted = true;
		}

		if (!this.refreshInProgress) {
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

	private toResolution<T>(
		resolution: EntitlementResolution<T>,
	): ResolutionDetails<T> {
		return {
			...resolution,
			errorCode: resolution.errorCode as ErrorCode | undefined,
		};
	}

	private async loadSnapshot(emitChange: boolean): Promise<void> {
		if (this.closed) throw new Error("Chargebee web provider is closed");

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
				this.events.emit(ProviderEvents.ConfigurationChanged, { flagsChanged });
			}
		} catch (error) {
			if (emitChange) {
				this.events.emit(ProviderEvents.Error, {
					message:
						error instanceof Error
							? error.message
							: "Unable to refresh Chargebee entitlements",
				});
			}
			throw error;
		}
	}
}
