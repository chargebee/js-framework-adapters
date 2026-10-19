import {
	type ChargebeeTarget,
	type EntitlementDetails,
	Feature,
	type ScopedEntitlementsClient,
	type TargetedEntitlementsClient,
} from "../shared";

/**
 * A server client bound to one target, so call sites read like the browser
 * client's:
 *
 * ```ts
 * const scoped = entitlements.for({ customerId });
 *
 * await scoped.get("licensed-seats", 0);
 * ```
 *
 * Cheap enough to create per request: it holds no state of its own and
 * shares the parent's cache, store, and in-flight refreshes. The target is
 * validated on each evaluation, like the parent's.
 */
export class ScopedEntitlements implements ScopedEntitlementsClient {
	constructor(
		private readonly client: TargetedEntitlementsClient,
		private readonly target: ChargebeeTarget,
	) {}

	async get<T>(featureId: string, defaultValue: T): Promise<T> {
		return (await this.getDetails(featureId, defaultValue)).value;
	}

	/** Like {@link get}, but returns the status and entitlement behind the value. */
	getDetails<T>(
		featureId: string,
		defaultValue: T,
	): Promise<EntitlementDetails<T>> {
		return this.client.getDetails(featureId, defaultValue, this.target);
	}

	/** Declares a feature bound to this target; its `get` takes no arguments. */
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
}
