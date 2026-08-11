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
} from "./shared";

export interface ChargebeeEntitlementsWebProviderOptions {
	relayUrl: string | URL;
	fetchImplementation?: typeof fetch;
	credentials?: RequestCredentials;
	requestHeaders?: HeadersInit;
}

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
		// The relay identity may have changed with the application session. Never
		// evaluate a new context against the previous subject's entitlements.
		this.snapshot = undefined;
		this.staleEventEmitted = false;
		await this.refreshSnapshot();
	}

	async onClose(): Promise<void> {
		this.closed = true;
		this.snapshot = undefined;
		this.staleEventEmitted = false;
	}

	async refreshSnapshot(): Promise<void> {
		await this.loadSnapshot(true);
	}

	resolveBooleanEvaluation(
		flagKey: string,
		defaultValue: boolean,
		_context: EvaluationContext,
		_logger: Logger,
	): ResolutionDetails<boolean> {
		const snapshot = this.getUsableSnapshot(defaultValue);
		if (!("entitlements" in snapshot)) return snapshot;
		return this.toResolution(
			resolveBooleanEntitlement(snapshot, flagKey, defaultValue, "relay"),
		);
	}

	resolveStringEvaluation(
		flagKey: string,
		defaultValue: string,
		_context: EvaluationContext,
		_logger: Logger,
	): ResolutionDetails<string> {
		const snapshot = this.getUsableSnapshot(defaultValue);
		if (!("entitlements" in snapshot)) return snapshot;
		return this.toResolution(
			resolveStringEntitlement(snapshot, flagKey, defaultValue, "relay"),
		);
	}

	resolveNumberEvaluation(
		flagKey: string,
		defaultValue: number,
		_context: EvaluationContext,
		_logger: Logger,
	): ResolutionDetails<number> {
		const snapshot = this.getUsableSnapshot(defaultValue);
		if (!("entitlements" in snapshot)) return snapshot;
		return this.toResolution(
			resolveNumberEntitlement(snapshot, flagKey, defaultValue, "relay"),
		);
	}

	resolveObjectEvaluation<T extends JsonValue>(
		flagKey: string,
		defaultValue: T,
		_context: EvaluationContext,
		_logger: Logger,
	): ResolutionDetails<T> {
		const snapshot = this.getUsableSnapshot(defaultValue);
		if (!("entitlements" in snapshot)) return snapshot;
		return this.toResolution(
			resolveObjectEntitlement(snapshot, flagKey, defaultValue, "relay"),
		);
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

		if (isSnapshotExpired(this.snapshot)) {
			if (!this.staleEventEmitted) {
				this.events.emit(ProviderEvents.Stale, {
					message: "Chargebee entitlement snapshot expired",
				});
				this.staleEventEmitted = true;
			}
			return {
				value: defaultValue,
				reason: "STALE",
			};
		}

		return this.snapshot;
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
			const previousFlags = new Set(
				this.snapshot ? Object.keys(this.snapshot.entitlements) : [],
			);
			const nextFlags = new Set(Object.keys(nextSnapshot.entitlements));
			const flagsChanged = [
				...new Set([...previousFlags, ...nextFlags]),
			].filter(
				(flag) =>
					JSON.stringify(this.snapshot?.entitlements[flag]) !==
					JSON.stringify(nextSnapshot.entitlements[flag]),
			);

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

export type {
	ChargebeeEntitlement,
	ChargebeeEntitlementsSnapshot,
} from "./shared";
