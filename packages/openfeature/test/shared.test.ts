import {
	createEntitlementsSnapshot,
	getTargetFromContext,
	resolveBooleanEntitlement,
	resolveNumberEntitlement,
	resolveObjectEntitlement,
	resolveStringEntitlement,
} from "../src/shared";

const now = Date.UTC(2026, 0, 1);

const snapshot = createEntitlementsSnapshot(
	"customer",
	[
		{ featureId: "switch-on", value: "true", isEnabled: true },
		{ featureId: "switch-off", value: "false", isEnabled: true },
		{ featureId: "switch-enabled", isEnabled: true },
		{ featureId: "seats", value: "25", isEnabled: true },
		{ featureId: "storage", value: "unlimited", isEnabled: true },
		{ featureId: "support", value: "priority", isEnabled: true },
		{ featureId: "disabled", value: "true", isEnabled: false },
		{
			featureId: "expired",
			value: "true",
			isEnabled: true,
			expiresAt: now / 1000 - 1,
		},
	],
	60_000,
	now,
);

describe("entitlement mapping", () => {
	it("maps switch entitlements to booleans", () => {
		expect(
			resolveBooleanEntitlement(snapshot, "switch-on", false, "api"),
		).toMatchObject({
			value: true,
			variant: "enabled",
			reason: "TARGETING_MATCH",
		});
		expect(
			resolveBooleanEntitlement(snapshot, "switch-off", true, "cache"),
		).toMatchObject({
			value: false,
			reason: "CACHED",
		});
		expect(
			resolveBooleanEntitlement(snapshot, "switch-enabled", false, "api"),
		).toMatchObject({
			value: true,
			variant: "enabled",
		});
	});

	it("maps numeric and unlimited entitlements", () => {
		expect(resolveNumberEntitlement(snapshot, "seats", 0, "store")).toMatchObject(
			{
				value: 25,
				reason: "CACHED",
			},
		);
		expect(
			resolveNumberEntitlement(snapshot, "storage", 0, "relay"),
		).toMatchObject({
			value: Number.POSITIVE_INFINITY,
			variant: "unlimited",
			flagMetadata: { unlimited: true },
		});
	});

	it("maps string and object entitlements", () => {
		expect(
			resolveStringEntitlement(snapshot, "support", "basic", "api"),
		).toMatchObject({
			value: "priority",
			variant: "priority",
		});
		expect(
			resolveObjectEntitlement(snapshot, "support", {}, "api").value,
		).toMatchObject({
			featureId: "support",
			value: "priority",
		});
	});

	it("fails closed for disabled, expired, missing, and mismatched values", () => {
		expect(
			resolveBooleanEntitlement(snapshot, "disabled", false, "api"),
		).toMatchObject({
			value: false,
			reason: "DISABLED",
		});
		expect(
			resolveBooleanEntitlement(snapshot, "expired", false, "api"),
		).toMatchObject({
			value: false,
			reason: "DISABLED",
		});
		expect(
			resolveBooleanEntitlement(snapshot, "missing", false, "api"),
		).toMatchObject({
			value: false,
			errorCode: "FLAG_NOT_FOUND",
		});
		expect(
			resolveBooleanEntitlement(snapshot, "support", false, "api"),
		).toMatchObject({
			value: false,
			errorCode: "TYPE_MISMATCH",
		});
	});
});

describe("target context", () => {
	it("resolves explicit customer and subscription targets", () => {
		expect(getTargetFromContext({ chargebeeCustomerId: "customer-1" })).toEqual({
			mode: "customer",
			customerId: "customer-1",
		});
		expect(
			getTargetFromContext({
				chargebeeEvaluationMode: "subscription",
				chargebeeSubscriptionId: "subscription-1",
			}),
		).toEqual({
			mode: "subscription",
			subscriptionId: "subscription-1",
		});
	});

	it("does not treat targetingKey as a Chargebee identifier", () => {
		expect(() => getTargetFromContext({ targetingKey: "app-user-1" })).toThrow(
			"chargebeeCustomerId",
		);
	});
});
