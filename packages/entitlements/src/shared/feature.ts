import type { ChargebeeTarget, EntitlementResolution } from "./types";

/**
 * The one method a {@link Feature} needs from a client. Both
 * `ChargebeeEntitlements` (server) and `ChargebeeEntitlementsWebClient` (web)
 * satisfy it directly.
 */
export interface EntitlementsClient {
	getValue<T>(
		featureId: string,
		defaultValue: T,
		target?: ChargebeeTarget,
	): Promise<EntitlementResolution<T>> | EntitlementResolution<T>;
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
 * `entitlements.feature(...)`, to bind one instead.
 */
export class Feature<T> {
	constructor(
		readonly featureId: string,
		readonly defaultValue: T,
		private readonly client?: EntitlementsClient,
	) {
		if (!featureId) throw new Error("featureId is required");
	}

	/**
	 * Resolves the feature's value for `target`, falling back to the default
	 * value when the feature is missing, disabled, or the snapshot is
	 * unavailable. On the browser web client, `target` is optional because the
	 * relay snapshot is already scoped to the session.
	 */
	async get(target?: ChargebeeTarget): Promise<T> {
		return (await this.getDetails(target)).value;
	}

	/** Like {@link get}, but returns the full resolution, not just the value. */
	async getDetails(
		target?: ChargebeeTarget,
	): Promise<EntitlementResolution<T>> {
		const client = this.client ?? defaultClient;
		if (!client) {
			throw new Error(
				`No Chargebee entitlements client is configured for feature "${this.featureId}". ` +
					"Register one with setDefaultEntitlements(client), or create the " +
					"feature with entitlements.feature(...).",
			);
		}

		return client.getValue(this.featureId, this.defaultValue, target);
	}
}
