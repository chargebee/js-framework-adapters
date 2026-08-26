import {
	ChargebeeEntitlements,
	type ChargebeeEntitlementsOptions,
} from "@chargebee/entitlements/server";
import { OpenFeature } from "@openfeature/server-sdk";
import { ChargebeeEntitlementsProvider } from "../src/server";

function makeClient() {
	const customerRequest = vi.fn(async () => ({
		list: [
			{
				customer_entitlement: {
					customer_id: "customer-1",
					feature_id: "sso",
					value: "true",
					is_enabled: true,
				},
			},
		],
	}));
	const client = {
		customerEntitlement: { entitlementsForCustomer: customerRequest },
		subscriptionEntitlement: {
			subscriptionEntitlementsForSubscription: vi.fn(async () => ({
				list: [],
			})),
		},
	} as unknown as ChargebeeEntitlementsOptions["chargebeeClient"];
	return { client, customerRequest };
}

const context = {
	targetingKey: "app-user-1",
	customerId: "customer-1",
};

afterEach(async () => {
	await OpenFeature.clearProviders();
});

describe("ChargebeeEntitlementsProvider", () => {
	it("constructs its own ChargebeeEntitlements from options and works through the OpenFeature server SDK", async () => {
		const { client } = makeClient();
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: client,
		});

		expect(provider.entitlements).toBeInstanceOf(ChargebeeEntitlements);
		await OpenFeature.setProviderAndWait(provider);

		await expect(
			OpenFeature.getClient().getBooleanValue("sso", false, context),
		).resolves.toBe(true);
	});

	it("wraps an existing ChargebeeEntitlements instance instead of creating a new one", async () => {
		const { client } = makeClient();
		const entitlements = new ChargebeeEntitlements({ chargebeeClient: client });
		const provider = new ChargebeeEntitlementsProvider({ entitlements });

		expect(provider.entitlements).toBe(entitlements);
		await expect(
			provider.resolveBooleanEvaluation("sso", false, context),
		).resolves.toMatchObject({ value: true, reason: "TARGETING_MATCH" });
	});

	it("evaluates string, number, and object flags", async () => {
		const customerRequest = vi.fn(async () => ({
			list: [
				{
					customer_entitlement: {
						customer_id: "customer-1",
						feature_id: "seats",
						value: "10",
						is_enabled: true,
					},
				},
			],
		}));
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: {
				customerEntitlement: { entitlementsForCustomer: customerRequest },
				subscriptionEntitlement: {
					subscriptionEntitlementsForSubscription: vi.fn(),
				},
			} as unknown as ChargebeeEntitlementsOptions["chargebeeClient"],
		});

		await expect(
			provider.resolveNumberEvaluation("seats", 0, context),
		).resolves.toMatchObject({ value: 10 });
		await expect(
			provider.resolveStringEvaluation("seats", "0", context),
		).resolves.toMatchObject({ value: "10" });
		await expect(
			provider.resolveObjectEvaluation("seats", {}, context),
		).resolves.toMatchObject({ value: { featureId: "seats", value: "10" } });
	});

	it("resolves a subscription-scoped context", async () => {
		const subscriptionRequest = vi.fn(async () => ({
			list: [
				{
					subscription_entitlement: {
						subscription_id: "subscription-1",
						feature_id: "seats",
						value: "50",
						is_enabled: true,
					},
				},
			],
		}));
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: {
				customerEntitlement: { entitlementsForCustomer: vi.fn() },
				subscriptionEntitlement: {
					subscriptionEntitlementsForSubscription: subscriptionRequest,
				},
			} as unknown as ChargebeeEntitlementsOptions["chargebeeClient"],
		});

		await expect(
			provider.resolveNumberEvaluation("seats", 0, {
				targetingKey: "app-user-1",
				subscriptionId: "subscription-1",
			}),
		).resolves.toMatchObject({ value: 50 });
	});

	it("passes through STALE with snapshotPending metadata while a background refresh loads", async () => {
		const { client } = makeClient();
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: client,
			refreshOnMiss: "background",
		});

		await expect(
			provider.resolveBooleanEvaluation("sso", false, context),
		).resolves.toEqual({
			value: false,
			reason: "STALE",
			flagMetadata: { snapshotPending: true },
		});
	});

	it("passes through INVALID_CONTEXT without calling Chargebee", async () => {
		const { client, customerRequest } = makeClient();
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: client,
		});

		await expect(
			provider.resolveBooleanEvaluation("sso", false, {
				targetingKey: "app-user-1",
			}),
		).resolves.toMatchObject({ value: false, errorCode: "INVALID_CONTEXT" });
		await expect(
			provider.resolveBooleanEvaluation("sso", false, {
				customerId: "customer-1",
				subscriptionId: "subscription-1",
			}),
		).resolves.toMatchObject({ value: false, errorCode: "INVALID_CONTEXT" });
		expect(customerRequest).not.toHaveBeenCalled();
	});

	it("delegates onClose to the wrapped entitlements client", async () => {
		const { client } = makeClient();
		const entitlements = new ChargebeeEntitlements({ chargebeeClient: client });
		const close = vi.spyOn(entitlements, "close");
		const provider = new ChargebeeEntitlementsProvider({ entitlements });

		await provider.onClose();

		expect(close).toHaveBeenCalledTimes(1);
	});
});
