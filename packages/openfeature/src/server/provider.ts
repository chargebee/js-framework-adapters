import type {
	ErrorCode,
	EvaluationContext,
	JsonValue,
	Logger,
	Provider,
	ResolutionDetails,
} from "@openfeature/server-sdk";
import {
	createEntitlementsCacheKey,
	TieredEntitlementsCache,
	type TieredEntitlementsCacheOptions,
} from "../cache";
import {
	type ChargebeeEntitlementsSnapshot,
	type ChargebeeEvaluationMode,
	type ChargebeeTarget,
	createEntitlementsSnapshot,
	type EntitlementResolution,
	getTargetFromContext,
	resolveBooleanEntitlement,
	resolveNumberEntitlement,
	resolveObjectEntitlement,
	resolveStringEntitlement,
} from "../shared";
import {
	type ChargebeeEntitlementsClient,
	ChargebeeEntitlementsLoader,
} from "./loader";

export interface ChargebeeEntitlementsProviderOptions {
	chargebeeClient: ChargebeeEntitlementsClient;
	defaultMode?: ChargebeeEvaluationMode;
	consolidateCustomerEntitlements?: boolean;
	resolveTarget?: (context: EvaluationContext) => ChargebeeTarget;
	cache?: TieredEntitlementsCache | TieredEntitlementsCacheOptions;
	cacheNamespace?: string;
	pageSize?: number;
	maxPages?: number;
}

export interface EntitlementsSnapshotResult {
	snapshot: ChargebeeEntitlementsSnapshot;
	source: "api" | "memory" | "redis";
}

interface InFlightSnapshotRequest {
	promise: Promise<EntitlementsSnapshotResult>;
	state: { invalidated: boolean };
}

class InvalidEntitlementContextError extends Error {}

export class ChargebeeEntitlementsProvider implements Provider {
	readonly metadata = { name: "Chargebee Entitlements" } as const;
	readonly runsOn = "server" as const;

	private readonly defaultMode: ChargebeeEvaluationMode;
	private readonly consolidateCustomerEntitlements: boolean;
	private readonly resolveTargetOption?: (
		context: EvaluationContext,
	) => ChargebeeTarget;
	private readonly cache: TieredEntitlementsCache;
	private readonly cacheNamespace?: string;
	private readonly loader: ChargebeeEntitlementsLoader;
	private readonly inFlight = new Map<string, InFlightSnapshotRequest>();

	constructor(options: ChargebeeEntitlementsProviderOptions) {
		if (!options?.chargebeeClient)
			throw new Error("chargebeeClient is required");

		this.defaultMode = options.defaultMode ?? "customer";
		this.consolidateCustomerEntitlements =
			options.consolidateCustomerEntitlements ?? true;
		this.resolveTargetOption = options.resolveTarget;
		this.cache =
			options.cache instanceof TieredEntitlementsCache
				? options.cache
				: new TieredEntitlementsCache(options.cache);
		this.cacheNamespace = options.cacheNamespace;
		this.loader = new ChargebeeEntitlementsLoader({
			chargebeeClient: options.chargebeeClient,
			consolidateCustomerEntitlements: this.consolidateCustomerEntitlements,
			pageSize: options.pageSize ?? 100,
			maxPages: options.maxPages ?? 50,
		});
	}

	async onClose(): Promise<void> {
		for (const request of this.inFlight.values()) {
			request.state.invalidated = true;
		}
		this.inFlight.clear();
		await this.cache.clearMemory();
	}

	resolveBooleanEvaluation(
		flagKey: string,
		defaultValue: boolean,
		context: EvaluationContext,
		logger: Logger,
	): Promise<ResolutionDetails<boolean>> {
		return this.evaluate(defaultValue, context, logger, (result) =>
			resolveBooleanEntitlement(
				result.snapshot,
				flagKey,
				defaultValue,
				result.source,
			),
		);
	}

	resolveStringEvaluation(
		flagKey: string,
		defaultValue: string,
		context: EvaluationContext,
		logger: Logger,
	): Promise<ResolutionDetails<string>> {
		return this.evaluate(defaultValue, context, logger, (result) =>
			resolveStringEntitlement(
				result.snapshot,
				flagKey,
				defaultValue,
				result.source,
			),
		);
	}

	resolveNumberEvaluation(
		flagKey: string,
		defaultValue: number,
		context: EvaluationContext,
		logger: Logger,
	): Promise<ResolutionDetails<number>> {
		return this.evaluate(defaultValue, context, logger, (result) =>
			resolveNumberEntitlement(
				result.snapshot,
				flagKey,
				defaultValue,
				result.source,
			),
		);
	}

	resolveObjectEvaluation<T extends JsonValue>(
		flagKey: string,
		defaultValue: T,
		context: EvaluationContext,
		logger: Logger,
	): Promise<ResolutionDetails<T>> {
		return this.evaluate(defaultValue, context, logger, (result) =>
			resolveObjectEntitlement(
				result.snapshot,
				flagKey,
				defaultValue,
				result.source,
			),
		);
	}

	async getSnapshot(
		context: EvaluationContext,
		logger?: Logger,
	): Promise<EntitlementsSnapshotResult> {
		const target = this.resolveTarget(context);
		const key = this.cacheKey(target);
		const cached = await this.cache.get(key);
		if (cached) return cached;

		const current = this.inFlight.get(key);
		if (current) return current.promise;

		const state = { invalidated: false };
		const promise = this.loadSnapshot(target, key, state, logger).finally(
			() => {
				if (this.inFlight.get(key)?.promise === promise) {
					this.inFlight.delete(key);
				}
			},
		);
		this.inFlight.set(key, { promise, state });
		return promise;
	}

	async getRelaySnapshot(
		context: EvaluationContext,
		ttlMs = 60_000,
		logger?: Logger,
	): Promise<ChargebeeEntitlementsSnapshot> {
		const { snapshot } = await this.getSnapshot(context, logger);
		return {
			...snapshot,
			expiresAt: new Date(
				Math.min(Date.parse(snapshot.expiresAt), Date.now() + ttlMs),
			).toISOString(),
		};
	}

	async invalidate(target: ChargebeeTarget): Promise<void> {
		const key = this.cacheKey(target);
		const current = this.inFlight.get(key);
		if (current) current.state.invalidated = true;
		this.inFlight.delete(key);
		await this.cache.delete(key);
	}

	clearMemoryCache(): Promise<void> {
		return this.cache.clearMemory();
	}

	private async evaluate<T>(
		defaultValue: T,
		context: EvaluationContext,
		logger: Logger,
		resolve: (result: EntitlementsSnapshotResult) => EntitlementResolution<T>,
	): Promise<ResolutionDetails<T>> {
		try {
			return this.toResolution(
				resolve(await this.getSnapshot(context, logger)),
			);
		} catch (error) {
			return this.errorResolution(defaultValue, error);
		}
	}

	private resolveTarget(context: EvaluationContext): ChargebeeTarget {
		try {
			return this.resolveTargetOption
				? this.resolveTargetOption(context)
				: getTargetFromContext(context, this.defaultMode);
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

	private async loadSnapshot(
		target: ChargebeeTarget,
		key: string,
		state: { invalidated: boolean },
		logger?: Logger,
	): Promise<EntitlementsSnapshotResult> {
		const snapshot = createEntitlementsSnapshot(
			target.mode,
			await this.loader.load(target, logger),
			this.cache.snapshotTtlMs,
		);
		if (!state.invalidated) await this.cache.set(key, snapshot);
		return { snapshot, source: "api" };
	}

	private errorResolution<T>(
		defaultValue: T,
		error: unknown,
	): ResolutionDetails<T> {
		return {
			value: defaultValue,
			reason: "ERROR",
			errorCode: (error instanceof InvalidEntitlementContextError
				? "INVALID_CONTEXT"
				: "GENERAL") as ErrorCode,
			errorMessage:
				error instanceof Error
					? error.message
					: "Unable to evaluate Chargebee entitlement",
		};
	}

	private toResolution<T>(
		resolution: EntitlementResolution<T>,
	): ResolutionDetails<T> {
		return {
			...resolution,
			errorCode: resolution.errorCode as ErrorCode | undefined,
		};
	}
}

export type { ChargebeeEntitlementsClient };
