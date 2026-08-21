import type { CustomerEntitlement } from "chargebee";
import {
	ChargebeeEntitlements,
	type ChargebeeEntitlementsClient,
} from "../src/server";
import type { EntitlementResolution, FeatureTarget } from "../src/shared";
import {
	type EntitlementsEvaluator,
	Feature,
	setDefaultEntitlements,
} from "../src/shared";

function makeEntitlements() {
	const customerRequest = vi.fn(async () => ({
		list: [
			{
				customer_entitlement: {
					customer_id: "customer-1",
					feature_id: "licensed-seats",
					value: "25",
					is_enabled: true,
				},
			},
			{
				customer_entitlement: {
					customer_id: "customer-1",
					feature_id: "advanced-reports",
					value: "true",
					is_enabled: true,
				},
			},
			{
				customer_entitlement: {
					customer_id: "customer-1",
					feature_id: "support-tier",
					value: "priority",
					is_enabled: true,
				},
			},
		] as Array<{ customer_entitlement: CustomerEntitlement }>,
	}));
	const client = {
		customerEntitlement: { entitlementsForCustomer: customerRequest },
		subscriptionEntitlement: {
			subscriptionEntitlementsForSubscription: vi.fn(),
		},
	} as unknown as ChargebeeEntitlementsClient;
	return new ChargebeeEntitlements({ chargebeeClient: client });
}

const target: FeatureTarget = { mode: "customer", customerId: "customer-1" };

afterEach(() => {
	setDefaultEntitlements(undefined);
});

describe("Feature", () => {
	it("resolves the unwrapped value against the default client", async () => {
		setDefaultEntitlements(makeEntitlements());

		const licensedSeats = new Feature("licensed-seats", {
			type: "number",
			defaultValue: 0,
		});

		const seats = await licensedSeats.get(target);

		expectTypeOf(seats).toEqualTypeOf<number>();
		expect(seats).toBe(25);
	});

	it("infers the value type from the declared feature type", async () => {
		const entitlements = makeEntitlements();

		const advancedReports = entitlements.feature("advanced-reports", {
			type: "boolean",
			defaultValue: false,
		});
		const supportTier = entitlements.feature("support-tier", {
			type: "string",
			defaultValue: "basic",
		});
		const seats = entitlements.feature("licensed-seats", {
			type: "number",
			defaultValue: 0,
		});

		const enabled = await advancedReports.get(target);
		const tier = await supportTier.get(target);
		const count = await seats.get(target);

		expectTypeOf(enabled).toEqualTypeOf<boolean>();
		expectTypeOf(tier).toEqualTypeOf<string>();
		expectTypeOf(count).toEqualTypeOf<number>();
		expect({ enabled, tier, count }).toEqual({
			enabled: true,
			tier: "priority",
			count: 25,
		});
	});

	it("resolves object features to the declared shape", async () => {
		const entitlements = makeEntitlements();
		const supportTier = entitlements.feature("support-tier", {
			type: "object",
			defaultValue: {} as { featureId: string; value?: string },
		});

		const details = await supportTier.getDetails(target);

		expectTypeOf(details).toEqualTypeOf<
			EntitlementResolution<{ featureId: string; value?: string }>
		>();
		expect(details.value).toMatchObject({
			featureId: "support-tier",
			value: "priority",
		});
	});

	it("exposes the full resolution via getDetails", async () => {
		const seats = makeEntitlements().feature("licensed-seats", {
			type: "number",
			defaultValue: 0,
		});

		const details = await seats.getDetails(target);

		expect(details).toMatchObject({
			value: 25,
			reason: "TARGETING_MATCH",
			flagMetadata: { chargebeeFeatureId: "licensed-seats" },
		});
	});

	it("falls back to the default value when the feature is missing", async () => {
		setDefaultEntitlements(makeEntitlements());
		const missing = new Feature("does-not-exist", {
			type: "number",
			defaultValue: 7,
		});

		await expect(missing.get(target)).resolves.toBe(7);
		await expect(missing.getDetails(target)).resolves.toMatchObject({
			value: 7,
			errorCode: "FLAG_NOT_FOUND",
		});
	});

	it("prefers an explicit client over the bound and default clients", async () => {
		const calls: string[] = [];
		const stub = (name: string): EntitlementsEvaluator => ({
			getBooleanValue: async () => ({ value: false }),
			getStringValue: async () => ({ value: "" }),
			getObjectValue: async <T>() => ({ value: undefined as T }),
			getNumberValue: async () => {
				calls.push(name);
				return { value: name === "override" ? 99 : 1 };
			},
		});
		setDefaultEntitlements(stub("default"));

		const seats = new Feature("licensed-seats", {
			type: "number",
			defaultValue: 0,
			client: stub("bound"),
		});

		await expect(
			seats.get(target, { client: stub("override") }),
		).resolves.toBe(99);
		expect(calls).toEqual(["override"]);
	});

	it("binds a copy to a client with withClient", async () => {
		const entitlements = makeEntitlements();
		const seats = new Feature("licensed-seats", {
			type: "number",
			defaultValue: 0,
		}).withClient(entitlements);

		await expect(seats.get(target)).resolves.toBe(25);
	});

	it("throws a helpful error when no client is configured", async () => {
		const seats = new Feature("licensed-seats", {
			type: "number",
			defaultValue: 0,
		});

		await expect(seats.get(target)).rejects.toThrow(
			/No Chargebee entitlements client is configured/,
		);
	});
});
