import type { ChargebeeTarget } from "./types";

const nonEmpty = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * Reduces a target to the single identifier it evaluates against, ignoring
 * any other properties a caller's context object carries.
 *
 * Both identifiers at once is rejected rather than prioritized: a customer's
 * consolidated entitlements and one subscription's entitlements are different
 * answers, and guessing which one was meant hides the mistake.
 */
export function assertTarget(target: ChargebeeTarget): ChargebeeTarget {
	const customerId = nonEmpty(target.customerId);
	const subscriptionId = nonEmpty(target.subscriptionId);

	if (customerId && subscriptionId) {
		throw new Error(
			"A Chargebee target takes customerId or subscriptionId, not both",
		);
	}
	if (customerId) return { customerId };
	if (subscriptionId) return { subscriptionId };
	throw new Error(
		"A Chargebee target requires a non-empty customerId or subscriptionId",
	);
}
