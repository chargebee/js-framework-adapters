import type {
	ErrorCode,
	EvaluationContext,
	JsonValue,
	Logger,
	Provider,
	ResolutionDetails,
} from "@openfeature/server-sdk";
import type Chargebee from "chargebee";
import type { CustomerEntitlement, SubscriptionEntitlement } from "chargebee";
import {
	createEntitlementsCacheKey,
	LayeredEntitlementsCache,
	type LayeredEntitlementsCacheOptions,
} from "./cache";
import {
	CHARGEBEE_CONTEXT_KEYS,
	type ChargebeeEntitlement,
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
} from "./shared";

export interface ChargebeeEntitlementsClient
	extends Pick<Chargebee, "customerEntitlement" | "subscriptionEntitlement"> {}

export interface ChargebeeEntitlementsProviderOptions {
	chargebeeClient: ChargebeeEntitlementsClient;
	defaultMode?: ChargebeeEvaluationMode;
	consolidateCustomerEntitlements?: boolean;
	resolveTarget?: (context: EvaluationContext) => ChargebeeTarget;
	cache?: LayeredEntitlementsCache | LayeredEntitlementsCacheOptions;
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

	private readonly chargebeeClient: ChargebeeEntitlementsClient;
	private readonly defaultMode: ChargebeeEvaluationMode;
	private readonly consolidateCustomerEntitlements: boolean;
	private readonly resolveTargetOption?: (
		context: EvaluationContext,
	) => ChargebeeTarget;
	private readonly cache: LayeredEntitlementsCache;
	private readonly cacheNamespace?: string;
	private readonly pageSize: number;
	private readonly maxPages: number;
	private readonly inFlight = new Map<string, InFlightSnapshotRequest>();

	constructor(options: ChargebeeEntitlementsProviderOptions) {
		if (!options?.chargebeeClient) {
			throw new Error("chargebeeClient is required");
		}
		this.chargebeeClient = options.chargebeeClient;
		this.defaultMode = options.defaultMode ?? "customer";
		this.consolidateCustomerEntitlements =
			options.consolidateCustomerEntitlements ?? true;
		this.resolveTargetOption = options.resolveTarget;
		this.cache =
			options.cache instanceof LayeredEntitlementsCache
				? options.cache
				: new LayeredEntitlementsCache(options.cache);
		this.cacheNamespace = options.cacheNamespace;
		this.pageSize = options.pageSize ?? 100;
		this.maxPages = options.maxPages ?? 50;

		if (
			!Number.isInteger(this.pageSize) ||
			this.pageSize < 1 ||
			this.pageSize > 100
		) {
			throw new Error("pageSize must be an integer between 1 and 100");
		}
		if (!Number.isInteger(this.maxPages) || this.maxPages < 1) {
			throw new Error("maxPages must be a positive integer");
		}
	}

	async initialize(): Promise<void> {
		// The server provider is context-dynamic, so initialization only validates
		// constructor configuration. Entitlements are loaded for each target lazily.
	}

	async onClose(): Promise<void> {
		for (const request of this.inFlight.values()) {
			request.state.invalidated = true;
		}
		this.inFlight.clear();
		await this.cache.clearMemory();
	}

	async resolveBooleanEvaluation(
		flagKey: string,
		defaultValue: boolean,
		context: EvaluationContext,
		logger: Logger,
	): Promise<ResolutionDetails<boolean>> {
		try {
			const result = await this.getSnapshot(context, logger);
			return this.toResolution(
				resolveBooleanEntitlement(
					result.snapshot,
					flagKey,
					defaultValue,
					result.source,
				),
			);
		} catch (error) {
			return this.errorResolution(defaultValue, error);
		}
	}

	async resolveStringEvaluation(
		flagKey: string,
		defaultValue: string,
		context: EvaluationContext,
		logger: Logger,
	): Promise<ResolutionDetails<string>> {
		try {
			const result = await this.getSnapshot(context, logger);
			return this.toResolution(
				resolveStringEntitlement(
					result.snapshot,
					flagKey,
					defaultValue,
					result.source,
				),
			);
		} catch (error) {
			return this.errorResolution(defaultValue, error);
		}
	}

	async resolveNumberEvaluation(
		flagKey: string,
		defaultValue: number,
		context: EvaluationContext,
		logger: Logger,
	): Promise<ResolutionDetails<number>> {
		try {
			const result = await this.getSnapshot(context, logger);
			return this.toResolution(
				resolveNumberEntitlement(
					result.snapshot,
					flagKey,
					defaultValue,
					result.source,
				),
			);
		} catch (error) {
			return this.errorResolution(defaultValue, error);
		}
	}

	async resolveObjectEvaluation<T extends JsonValue>(
		flagKey: string,
		defaultValue: T,
		context: EvaluationContext,
		logger: Logger,
	): Promise<ResolutionDetails<T>> {
		try {
			const result = await this.getSnapshot(context, logger);
			return this.toResolution(
				resolveObjectEntitlement(
					result.snapshot,
					flagKey,
					defaultValue,
					result.source,
				),
			);
		} catch (error) {
			return this.errorResolution(defaultValue, error);
		}
	}

	async getSnapshot(
		context: EvaluationContext,
		logger?: Logger,
	): Promise<EntitlementsSnapshotResult> {
		const target = this.resolveTarget(context);
		const key = this.cacheKey(target);
		const cached = await this.cache.get(key);
		if (cached) return cached;

		const existingRequest = this.inFlight.get(key);
		if (existingRequest) return existingRequest.promise;

		const state = { invalidated: false };
		const request = this.fetchSnapshot(target, key, state, logger).finally(
			() => {
				if (this.inFlight.get(key)?.promise === request) {
					this.inFlight.delete(key);
				}
			},
		);
		this.inFlight.set(key, { promise: request, state });
		return request;
	}

	async getRelaySnapshot(
		context: EvaluationContext,
		ttlMs = 60_000,
		logger?: Logger,
	): Promise<ChargebeeEntitlementsSnapshot> {
		const { snapshot } = await this.getSnapshot(context, logger);
		const relayExpiresAt = Math.min(
			Date.parse(snapshot.expiresAt),
			Date.now() + ttlMs,
		);
		return {
			...snapshot,
			expiresAt: new Date(relayExpiresAt).toISOString(),
		};
	}

	async invalidate(target: ChargebeeTarget): Promise<void> {
		const key = this.cacheKey(target);
		const inFlightRequest = this.inFlight.get(key);
		if (inFlightRequest) inFlightRequest.state.invalidated = true;
		this.inFlight.delete(key);
		await this.cache.delete(key);
	}

	async clearMemoryCache(): Promise<void> {
		await this.cache.clearMemory();
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

	private async fetchSnapshot(
		target: ChargebeeTarget,
		key: string,
		state: { invalidated: boolean },
		logger?: Logger,
	): Promise<EntitlementsSnapshotResult> {
		const entitlements =
			target.mode === "customer"
				? await this.fetchCustomerEntitlements(target.customerId, logger)
				: await this.fetchSubscriptionEntitlements(
						target.subscriptionId,
						logger,
					);
		const snapshot = createEntitlementsSnapshot(
			target.mode,
			entitlements,
			this.cache.snapshotTtlMs,
		);
		if (!state.invalidated) {
			await this.cache.set(key, snapshot);
		}
		return { snapshot, source: "api" };
	}

	private async fetchCustomerEntitlements(
		customerId: string,
		logger?: Logger,
	): Promise<ChargebeeEntitlement[]> {
		const entitlements: ChargebeeEntitlement[] = [];
		let offset: string | undefined;

		for (let page = 0; page < this.maxPages; page += 1) {
			const response =
				await this.chargebeeClient.customerEntitlement.entitlementsForCustomer(
					customerId,
					{
						limit: this.pageSize,
						offset,
						consolidate_entitlements: this.consolidateCustomerEntitlements,
					},
				);
			for (const item of response.list) {
				const normalized = this.normalizeCustomerEntitlement(
					item.customer_entitlement,
				);
				if (normalized) entitlements.push(normalized);
				else
					logger?.warn("Chargebee customer entitlement omitted a feature_id");
			}

			offset = response.next_offset;
			if (!offset) return entitlements;
		}

		throw new Error(
			`Chargebee customer entitlement pagination exceeded ${this.maxPages} pages`,
		);
	}

	private async fetchSubscriptionEntitlements(
		subscriptionId: string,
		logger?: Logger,
	): Promise<ChargebeeEntitlement[]> {
		const entitlements: ChargebeeEntitlement[] = [];
		let offset: string | undefined;

		for (let page = 0; page < this.maxPages; page += 1) {
			const response =
				await this.chargebeeClient.subscriptionEntitlement.subscriptionEntitlementsForSubscription(
					subscriptionId,
					{ limit: this.pageSize, offset },
				);
			for (const item of response.list) {
				const normalized = this.normalizeSubscriptionEntitlement(
					item.subscription_entitlement,
				);
				if (normalized) entitlements.push(normalized);
				else
					logger?.warn(
						"Chargebee subscription entitlement omitted a feature_id",
					);
			}

			offset = response.next_offset;
			if (!offset) return entitlements;
		}

		throw new Error(
			`Chargebee subscription entitlement pagination exceeded ${this.maxPages} pages`,
		);
	}

	private normalizeCustomerEntitlement(
		entitlement: CustomerEntitlement,
	): ChargebeeEntitlement | undefined {
		if (!entitlement.feature_id) return undefined;
		return {
			featureId: entitlement.feature_id,
			isEnabled: entitlement.is_enabled,
			...(entitlement.value !== undefined ? { value: entitlement.value } : {}),
			...(entitlement.name !== undefined ? { name: entitlement.name } : {}),
		};
	}

	private normalizeSubscriptionEntitlement(
		entitlement: SubscriptionEntitlement,
	): ChargebeeEntitlement | undefined {
		if (!entitlement.feature_id) return undefined;
		return {
			featureId: entitlement.feature_id,
			isEnabled: entitlement.is_enabled,
			isOverridden: entitlement.is_overridden,
			...(entitlement.value !== undefined ? { value: entitlement.value } : {}),
			...(entitlement.name !== undefined ? { name: entitlement.name } : {}),
			...(entitlement.feature_name !== undefined
				? { featureName: entitlement.feature_name }
				: {}),
			...(entitlement.feature_unit !== undefined
				? { featureUnit: entitlement.feature_unit }
				: {}),
			...(entitlement.feature_type !== undefined
				? { featureType: entitlement.feature_type }
				: {}),
			...(entitlement.expires_at !== undefined
				? { expiresAt: entitlement.expires_at }
				: {}),
		};
	}

	private errorResolution<T>(
		defaultValue: T,
		error: unknown,
	): ResolutionDetails<T> {
		const invalidContext = error instanceof InvalidEntitlementContextError;
		return {
			value: defaultValue,
			reason: "ERROR",
			errorCode: (invalidContext ? "INVALID_CONTEXT" : "GENERAL") as ErrorCode,
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

export interface CreateEntitlementsRelayHandlerOptions {
	provider: ChargebeeEntitlementsProvider;
	resolveContext: (
		request: Request,
	) => EvaluationContext | null | Promise<EvaluationContext | null>;
	snapshotTtlMs?: number;
	onError?: (error: unknown, request: Request) => Response | Promise<Response>;
}

const PRIVATE_NO_STORE_HEADERS = {
	"Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
	"Content-Type": "application/json",
} as const;

export function createEntitlementsRelayHandler(
	options: CreateEntitlementsRelayHandlerOptions,
): (request: Request) => Promise<Response> {
	return async (request: Request): Promise<Response> => {
		try {
			if (request.method !== "GET") {
				return Response.json(
					{ error: "Method not allowed" },
					{
						status: 405,
						headers: { ...PRIVATE_NO_STORE_HEADERS, Allow: "GET" },
					},
				);
			}

			const url = new URL(request.url);
			for (const key of Object.values(CHARGEBEE_CONTEXT_KEYS)) {
				if (url.searchParams.has(key)) {
					return Response.json(
						{ error: "Billing identity must be resolved by the server" },
						{ status: 400, headers: PRIVATE_NO_STORE_HEADERS },
					);
				}
			}

			const context = await options.resolveContext(request);
			if (!context) {
				return Response.json(
					{ error: "Unauthorized" },
					{ status: 401, headers: PRIVATE_NO_STORE_HEADERS },
				);
			}

			const snapshot = await options.provider.getRelaySnapshot(
				context,
				options.snapshotTtlMs,
			);
			return Response.json(snapshot, {
				status: 200,
				headers: PRIVATE_NO_STORE_HEADERS,
			});
		} catch (error) {
			if (options.onError) return options.onError(error, request);
			return Response.json(
				{ error: "Unable to load entitlements" },
				{ status: 502, headers: PRIVATE_NO_STORE_HEADERS },
			);
		}
	};
}

export { CHARGEBEE_CONTEXT_KEYS };
export type {
	ChargebeeEntitlement,
	ChargebeeEntitlementsSnapshot,
	ChargebeeEvaluationMode,
	ChargebeeTarget,
};
