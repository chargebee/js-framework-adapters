import type { CustomerEntitlement } from "chargebee";
import { ChargebeeEntitlements } from "../src/server";
import type { ChargebeeEntitlementsClient } from "../src/server/loader";
import type {
	ChargebeeTarget,
	EntitlementResolution,
	EntitlementsClient,
} from "../src/shared";
import { Feature, setDefaultEntitlements } from "../src/shared";

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

const target: ChargebeeTarget = { customerId: "customer-1" };

afterEach(() => {
	setDefaultEntitlements(undefined);
});

describe("Feature", () => {
	it("resolves the unwrapped value against the default client", async () => {
		setDefaultEntitlements(makeEntitlements());

		const licensedSeats = new Feature<number>("licensed-seats", 0);

		const seats = await licensedSeats.get(target);

		expectTypeOf(seats).toEqualTypeOf<number>();
		expect(seats).toBe(25);
	});

	it("takes the value type from the declared default value", async () => {
		const entitlements = makeEntitlements();

		const advancedReports = entitlements.feature("advanced-reports", false);
		const supportTier = entitlements.feature("support-tier", "basic");
		const seats = entitlements.feature("licensed-seats", 0);

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

	it("infers the type parameter from the default value", async () => {
		setDefaultEntitlements(makeEntitlements());

		const seats = new Feature("licensed-seats", 0);

		expectTypeOf(seats).toEqualTypeOf<Feature<number>>();
		expectTypeOf(await seats.get(target)).toEqualTypeOf<number>();
	});

	it("resolves object features to the declared shape", async () => {
		const entitlements = makeEntitlements();
		const supportTier = entitlements.feature(
			"support-tier",
			{} as { featureId: string; value?: string },
		);

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
		const seats = makeEntitlements().feature("licensed-seats", 0);

		const details = await seats.getDetails(target);

		expect(details).toMatchObject({
			value: 25,
			reason: "TARGETING_MATCH",
			flagMetadata: { chargebeeFeatureId: "licensed-seats" },
		});
	});

	it("falls back to the default value when the feature is missing", async () => {
		setDefaultEntitlements(makeEntitlements());
		const missing = new Feature("does-not-exist", 7);

		await expect(missing.get(target)).resolves.toBe(7);
		await expect(missing.getDetails(target)).resolves.toMatchObject({
			value: 7,
			errorCode: "FLAG_NOT_FOUND",
		});
	});

	it("prefers a bound client over the default one", async () => {
		const calls: string[] = [];
		const stub = (name: string, value: number): EntitlementsClient => ({
			getValue: async () => {
				calls.push(name);
				return { value: value as never };
			},
		});
		setDefaultEntitlements(stub("default", 1));

		const seats = new Feature("licensed-seats", 0, stub("bound", 2));

		await expect(seats.get(target)).resolves.toBe(2);
		expect(calls).toEqual(["bound"]);
	});

	it("binds a client through the constructor", async () => {
		const seats = new Feature("licensed-seats", 0, makeEntitlements());

		await expect(seats.get(target)).resolves.toBe(25);
	});

	it("throws a helpful error when no client is configured", async () => {
		const seats = new Feature("licensed-seats", 0);

		await expect(seats.get(target)).rejects.toThrow(
			/No Chargebee entitlements client is configured/,
		);
	});
});

describe("ChargebeeEntitlements.getValue", () => {
	it("resolves every shape through a single method", async () => {
		const entitlements = makeEntitlements();

		await expect(
			entitlements.getValue("licensed-seats", 0, target),
		).resolves.toMatchObject({ value: 25 });
		await expect(
			entitlements.getValue("support-tier", "basic", target),
		).resolves.toMatchObject({ value: "priority" });
		await expect(
			entitlements.getValue("advanced-reports", false, target),
		).resolves.toMatchObject({ value: true });
		await expect(
			entitlements.getValue("support-tier", {}, target),
		).resolves.toMatchObject({ value: { featureId: "support-tier" } });
	});
});
