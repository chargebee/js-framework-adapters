import type {
	ChargebeeTarget,
	EntitlementResolution,
	EvaluationContextLike,
	Logger,
} from "./types";

/** A Chargebee evaluation target, or a context bag it can be derived from. */
export type FeatureTarget = ChargebeeTarget | EvaluationContextLike;

/**
 * The declared shape of a {@link Feature}'s value. It selects the evaluation
 * method used and, through {@link FeatureTypeFor}, the value type `get`
 * resolves to.
 */
export type FeatureType = "boolean" | "string" | "number" | "object";

/** Maps a resolved value type back to the {@link FeatureType} that declares it. */
export type FeatureTypeFor<T> = [T] extends [boolean]
	? "boolean"
	: [T] extends [string]
		? "string"
		: [T] extends [number]
			? "number"
			: "object";

/**
 * The subset of a Chargebee entitlements client a {@link Feature} evaluates
 * against. The server `ChargebeeEntitlements` client satisfies it directly, so
 * a feature can resolve values without holding a reference to the concrete
 * class.
 */
export interface EntitlementsEvaluator {
	getBooleanValue(
		flagKey: string,
		defaultValue: boolean,
		target: FeatureTarget,
		logger?: Logger,
	): Promise<EntitlementResolution<boolean>>;
	getStringValue(
		flagKey: string,
		defaultValue: string,
		target: FeatureTarget,
		logger?: Logger,
	): Promise<EntitlementResolution<string>>;
	getNumberValue(
		flagKey: string,
		defaultValue: number,
		target: FeatureTarget,
		logger?: Logger,
	): Promise<EntitlementResolution<number>>;
	getObjectValue<T>(
		flagKey: string,
		defaultValue: T,
		target: FeatureTarget,
		logger?: Logger,
	): Promise<EntitlementResolution<T>>;
}

/**
 * Declares a single feature. `type` and `defaultValue` must agree: declaring
 * `type: "number"` requires a numeric `defaultValue`, which in turn types the
 * value `get` resolves to.
 */
export interface FeatureDefinition<T> {
	type: FeatureTypeFor<T>;
	defaultValue: T;
	/**
	 * Evaluates this feature instead of the client registered with
	 * {@link setDefaultEntitlements}. Prefer `entitlements.feature(...)` when a
	 * client is already in scope.
	 */
	client?: EntitlementsEvaluator;
}

export interface FeatureGetOptions {
	/** Overrides the feature's bound client and the default client for one call. */
	client?: EntitlementsEvaluator;
	logger?: Logger;
}

let defaultEvaluator: EntitlementsEvaluator | undefined;

/**
 * Registers the client that standalone {@link Feature} instances evaluate
 * against. Call it once during application start-up, before the first
 * `feature.get(...)`. Pass `undefined` to clear it (useful in tests).
 */
export function setDefaultEntitlements(
	client: EntitlementsEvaluator | undefined,
): void {
	defaultEvaluator = client;
}

/** Returns the client registered with {@link setDefaultEntitlements}, if any. */
export function getDefaultEntitlements(): EntitlementsEvaluator | undefined {
	return defaultEvaluator;
}

/**
 * A declared feature whose value is fetched with a single concise `get` call.
 *
 * ```ts
 * const licensedSeats = new Feature("licensed-seats", {
 *   type: "number",
 *   defaultValue: 0,
 * });
 *
 * const seats = await licensedSeats.get({
 *   mode: "customer",
 *   customerId: ctx.user.chargebeeCustomerId,
 * });
 * ```
 *
 * A standalone `new Feature(...)` resolves against the client registered with
 * {@link setDefaultEntitlements}. Bind a specific client with
 * `entitlements.feature(...)`, the `client` definition option, or the `client`
 * option on `get`.
 */
export class Feature<T> {
	readonly featureId: string;
	readonly type: FeatureType;
	readonly defaultValue: T;
	private readonly boundClient?: EntitlementsEvaluator;

	constructor(featureId: string, definition: FeatureDefinition<T>) {
		if (!featureId) throw new Error("featureId is required");
		this.featureId = featureId;
		this.type = definition.type;
		this.defaultValue = definition.defaultValue;
		this.boundClient = definition.client;
	}

	/**
	 * Resolves the feature's value for `target`, falling back to `defaultValue`
	 * when the feature is missing, disabled, or the snapshot is unavailable. Use
	 * {@link getDetails} when the reason or Chargebee metadata is needed.
	 */
	async get(target: FeatureTarget, options?: FeatureGetOptions): Promise<T> {
		return (await this.getDetails(target, options)).value;
	}

	/** Like {@link get}, but returns the full resolution, not just the value. */
	getDetails(
		target: FeatureTarget,
		options?: FeatureGetOptions,
	): Promise<EntitlementResolution<T>> {
		const client = options?.client ?? this.boundClient ?? defaultEvaluator;
		if (!client) {
			throw new Error(
				`No Chargebee entitlements client is configured for feature "${this.featureId}". ` +
					"Register one with setDefaultEntitlements(client), create the feature " +
					"with entitlements.feature(...), or pass { client } to get().",
			);
		}

		const { logger } = options ?? {};
		switch (this.type) {
			case "boolean":
				return client.getBooleanValue(
					this.featureId,
					this.defaultValue as boolean,
					target,
					logger,
				) as Promise<EntitlementResolution<T>>;
			case "string":
				return client.getStringValue(
					this.featureId,
					this.defaultValue as string,
					target,
					logger,
				) as Promise<EntitlementResolution<T>>;
			case "number":
				return client.getNumberValue(
					this.featureId,
					this.defaultValue as number,
					target,
					logger,
				) as Promise<EntitlementResolution<T>>;
			default:
				return client.getObjectValue<T>(
					this.featureId,
					this.defaultValue,
					target,
					logger,
				);
		}
	}

	/** Returns a copy of this feature bound to `client`. */
	withClient(client: EntitlementsEvaluator): Feature<T> {
		return new Feature(this.featureId, {
			type: this.type as FeatureTypeFor<T>,
			defaultValue: this.defaultValue,
			client,
		});
	}
}
