import type { ChargebeeTarget, EntitlementDetails } from "./types";

/**
 * A server client (`ChargebeeEntitlements` from `/server`): every evaluation
 * names a target.
 */
export interface TargetedEntitlementsClient {
	getDetails<T>(
		featureId: string,
		defaultValue: T,
		target: ChargebeeTarget,
	): Promise<EntitlementDetails<T>>;
}

/**
 * A client already bound to one target, so evaluations take none: the
 * browser client (its relay snapshot belongs to the session), or a server
 * client scoped with `entitlements.for(target)`.
 */
export interface ScopedEntitlementsClient {
	getDetails<T>(
		featureId: string,
		defaultValue: T,
	): EntitlementDetails<T> | Promise<EntitlementDetails<T>>;
}

/** Any client a {@link Feature} can evaluate against. */
export type EntitlementsClient =
	| TargetedEntitlementsClient
	| ScopedEntitlementsClient;

/**
 * `get` arguments for a client type:
 *
 * - server client → `get(target)`
 * - scoped client (browser, `entitlements.for(target)`) → `get()`
 * - unknown (standalone feature, default client) → either
 */
type TargetArgs<C extends EntitlementsClient> =
	C extends ScopedEntitlementsClient ? [] : [target: ChargebeeTarget];

/**
 * How a {@link Feature} calls whichever client it resolves to. A web client
 * ignores the extra `target` argument.
 */
interface AnyEntitlementsClient {
	getDetails<T>(
		featureId: string,
		defaultValue: T,
		target?: ChargebeeTarget,
	): Promise<EntitlementDetails<T>> | EntitlementDetails<T>;
}

let defaultClient: EntitlementsClient | undefined;

/**
 * Registers the client that standalone {@link Feature} instances evaluate
 * against. Call it once during application start-up, before the first
 * `feature.get(...)`. Pass `undefined` to clear it (useful in tests).
 */
export function setDefaultEntitlements(
	client: EntitlementsClient | undefined,
): void {
	defaultClient = client;
}

/**
 * A declared feature whose value is fetched with a single `get` call, typed as
 * whatever the feature holds:
 *
 * ```ts
 * const seats = new Feature<number>("licensed-seats", 0);
 *
 * const count = await seats.get({ customerId: user.chargebeeCustomerId });
 * ```
 *
 * The type parameter is optional — `new Feature("licensed-seats", 0)` infers
 * `Feature<number>` from the default value, which is also what tells the
 * resolver at runtime to read Chargebee's stored `"25"` as a number.
 *
 * A standalone feature resolves against the client registered with
 * {@link setDefaultEntitlements}. Pass a client as the third argument, or use
 * `entitlements.feature(...)`, to bind one instead. A bound feature's `get`
 * requires a target on a server client and takes none on a scoped one.
 */
export class Feature<T, C extends EntitlementsClient = EntitlementsClient> {
	constructor(
		readonly featureId: string,
		readonly defaultValue: T,
		private readonly client?: C,
	) {
		if (!featureId) throw new Error("featureId is required");
	}

	/**
	 * Resolves the feature's value for `target`, falling back to the default
	 * value when the feature is missing, disabled, or the snapshot is
	 * unavailable. On the browser web client there is no target, because the
	 * relay snapshot is already scoped to the session.
	 */
	async get(...args: TargetArgs<C>): Promise<T> {
		return (await this.getDetails(...args)).value;
	}

	/** Like {@link get}, but returns the status and entitlement behind the value. */
	async getDetails(...args: TargetArgs<C>): Promise<EntitlementDetails<T>> {
		const [target] = args;
		const client: AnyEntitlementsClient | undefined =
			this.client ?? defaultClient;
		if (!client) {
			throw new Error(
				`No Chargebee entitlements client is configured for feature "${this.featureId}". ` +
					"Register one with setDefaultEntitlements(client), or create the " +
					"feature with entitlements.feature(...).",
			);
		}

		return client.getDetails(this.featureId, this.defaultValue, target);
	}
}
