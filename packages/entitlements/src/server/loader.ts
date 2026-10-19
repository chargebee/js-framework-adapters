import type Chargebee from "chargebee";
import type { CustomerEntitlement, SubscriptionEntitlement } from "chargebee";
import type { ChargebeeEntitlement, ChargebeeTarget, Logger } from "../shared";

export type ChargebeeEntitlementsClient = Pick<
	Chargebee,
	"customerEntitlement" | "subscriptionEntitlement"
>;

interface EntitlementsPage<T> {
	list: T[];
	next_offset?: string;
}

interface EntitlementsLoaderOptions {
	chargebeeClient: ChargebeeEntitlementsClient;
	consolidateCustomerEntitlements: boolean;
	pageSize: number;
	maxPages: number;
	logger?: Logger;
}

type RawEntitlement = Partial<CustomerEntitlement & SubscriptionEntitlement>;

function withoutUndefined<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;
}

function normalizeEntitlement(
	entitlement: RawEntitlement,
): ChargebeeEntitlement | undefined {
	if (!entitlement.feature_id) return undefined;
	return withoutUndefined({
		featureId: entitlement.feature_id,
		isEnabled: entitlement.is_enabled ?? false,
		isOverridden: entitlement.is_overridden,
		value: entitlement.value,
		name: entitlement.name,
		featureName: entitlement.feature_name,
		featureUnit: entitlement.feature_unit,
		featureType: entitlement.feature_type,
		expiresAt: entitlement.expires_at,
	});
}

export class ChargebeeEntitlementsLoader {
	constructor(private readonly options: EntitlementsLoaderOptions) {
		if (
			!Number.isInteger(options.pageSize) ||
			options.pageSize < 1 ||
			options.pageSize > 100
		) {
			throw new Error("pageSize must be an integer between 1 and 100");
		}
		if (!Number.isInteger(options.maxPages) || options.maxPages < 1) {
			throw new Error("maxPages must be a positive integer");
		}
	}

	load(target: ChargebeeTarget): Promise<ChargebeeEntitlement[]> {
		const normalize = (item: {
			customer_entitlement?: CustomerEntitlement;
			subscription_entitlement?: SubscriptionEntitlement;
		}) =>
			normalizeEntitlement(
				item.customer_entitlement ?? item.subscription_entitlement ?? {},
			);

		if (target.subscriptionId !== undefined) {
			const { subscriptionId } = target;
			return this.collect(
				(offset) =>
					this.options.chargebeeClient.subscriptionEntitlement.subscriptionEntitlementsForSubscription(
						subscriptionId,
						{ limit: this.options.pageSize, offset },
					),
				normalize,
				"subscription",
			);
		}

		const { customerId } = target;
		return this.collect(
			(offset) =>
				this.options.chargebeeClient.customerEntitlement.entitlementsForCustomer(
					customerId,
					{
						limit: this.options.pageSize,
						offset,
						consolidate_entitlements:
							this.options.consolidateCustomerEntitlements,
					},
				),
			normalize,
			"customer",
		);
	}

	private async collect<T>(
		loadPage: (offset?: string) => Promise<EntitlementsPage<T>>,
		normalize: (item: T) => ChargebeeEntitlement | undefined,
		scope: "customer" | "subscription",
	): Promise<ChargebeeEntitlement[]> {
		const entitlements: ChargebeeEntitlement[] = [];
		let offset: string | undefined;

		for (let page = 0; page < this.options.maxPages; page += 1) {
			const response = await loadPage(offset);
			for (const item of response.list) {
				const entitlement = normalize(item);
				if (entitlement) entitlements.push(entitlement);
				else
					this.options.logger?.warn(
						`Chargebee ${scope} entitlement omitted a feature_id`,
					);
			}

			offset = response.next_offset;
			if (!offset) return entitlements;
		}

		throw new Error(
			`Chargebee ${scope} entitlement pagination exceeded ${this.options.maxPages} pages`,
		);
	}
}
