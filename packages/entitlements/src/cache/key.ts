import type { ChargebeeTarget } from "../shared";

export function createEntitlementsCacheKey(
	target: ChargebeeTarget,
	options: {
		namespace?: string;
		consolidateCustomerEntitlements?: boolean;
	} = {},
): string {
	const namespace = options.namespace ?? "chargebee:entitlements:v1";
	if (target.subscriptionId !== undefined) {
		return `${namespace}:subscription:${encodeURIComponent(target.subscriptionId)}`;
	}

	const view =
		(options.consolidateCustomerEntitlements ?? true)
			? "consolidated"
			: "individual";
	return `${namespace}:customer:${encodeURIComponent(target.customerId)}:${view}`;
}
