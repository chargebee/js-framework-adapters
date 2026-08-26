import type { ChargebeeEntitlement } from "../src/shared";
import {
	assertTarget,
	createEntitlementsSnapshot,
	isSnapshotExpired,
	parseEntitlementsSnapshot,
	parseSerializedEntitlementsSnapshot,
	resolveEntitlement,
	serializeEntitlementsSnapshot,
} from "../src/shared";

const now = Date.UTC(2026, 0, 1);

const snapshot = createEntitlementsSnapshot(
	[
		{ featureId: "switch-on", value: "true", isEnabled: true },
		{ featureId: "switch-off", value: "false", isEnabled: true },
		{ featureId: "switch-enabled", isEnabled: true },
		{ featureId: "switch-available", value: "available", isEnabled: true },
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
			resolveEntitlement(snapshot, "switch-on", false, "api"),
		).toMatchObject({
			value: true,
			variant: "enabled",
			reason: "TARGETING_MATCH",
		});
		expect(
			resolveEntitlement(snapshot, "switch-off", true, "cache"),
		).toMatchObject({ value: false, reason: "CACHED" });
		expect(
			resolveEntitlement(snapshot, "switch-enabled", false, "api"),
		).toMatchObject({ value: true, variant: "enabled" });
		expect(
			resolveEntitlement(snapshot, "switch-available", false, "api"),
		).toMatchObject({ value: true });
	});

	it("maps numeric and unlimited entitlements", () => {
		expect(resolveEntitlement(snapshot, "seats", 0, "store")).toMatchObject({
			value: 25,
			reason: "CACHED",
		});
		expect(resolveEntitlement(snapshot, "storage", 0, "relay")).toMatchObject({
			value: Number.POSITIVE_INFINITY,
			variant: "unlimited",
			flagMetadata: { unlimited: true },
		});
	});

	it("maps string and object entitlements", () => {
		expect(
			resolveEntitlement(snapshot, "support", "basic", "api"),
		).toMatchObject({ value: "priority", variant: "priority" });
		expect(
			resolveEntitlement<Partial<ChargebeeEntitlement>>(
				snapshot,
				"support",
				{},
				"api",
			).value,
		).toMatchObject({ featureId: "support", value: "priority" });
	});

	it("takes the value's shape from the default value alone", () => {
		expect(resolveEntitlement(snapshot, "switch-on", "off", "api").value).toBe(
			"true",
		);
		expect(resolveEntitlement(snapshot, "seats", "0", "api").value).toBe("25");
		expect(
			resolveEntitlement<Partial<ChargebeeEntitlement>>(
				snapshot,
				"seats",
				{},
				"api",
			).value,
		).toMatchObject({ featureId: "seats", value: "25" });
	});

	it("fails closed for disabled, expired, missing, and mismatched values", () => {
		expect(resolveEntitlement(snapshot, "disabled", false, "api")).toMatchObject(
			{ value: false, reason: "DISABLED" },
		);
		expect(resolveEntitlement(snapshot, "expired", false, "api")).toMatchObject({
			value: false,
			reason: "DISABLED",
		});
		expect(resolveEntitlement(snapshot, "missing", false, "api")).toMatchObject({
			value: false,
			errorCode: "FLAG_NOT_FOUND",
		});
		expect(resolveEntitlement(snapshot, "support", false, "api")).toMatchObject({
			value: false,
			errorCode: "TYPE_MISMATCH",
		});
		expect(resolveEntitlement(snapshot, "support", 0, "api")).toMatchObject({
			value: 0,
			errorCode: "TYPE_MISMATCH",
		});
		expect(
			resolveEntitlement(snapshot, "switch-enabled", "basic", "api"),
		).toMatchObject({ value: "basic", errorCode: "PARSE_ERROR" });
	});
});

describe("target validation", () => {
	it("reduces a target to the single identifier it evaluates against", () => {
		expect(assertTarget({ customerId: "customer-1" })).toEqual({
			customerId: "customer-1",
		});
		expect(assertTarget({ subscriptionId: "subscription-1" })).toEqual({
			subscriptionId: "subscription-1",
		});
	});

	it("ignores unrelated properties a caller's context carries", () => {
		const context = {
			targetingKey: "app-user-1",
			customerId: "customer-1",
			plan: "pro",
		};

		expect(assertTarget(context)).toEqual({ customerId: "customer-1" });
	});

	it("rejects an ambiguous target rather than guessing", () => {
		expect(() =>
			assertTarget({
				customerId: "customer-1",
				subscriptionId: "subscription-1",
			} as never),
		).toThrow("not both");
	});

	it("rejects a target with no usable identifier", () => {
		expect(() => assertTarget({ targetingKey: "app-user-1" } as never)).toThrow(
			"requires a non-empty customerId or subscriptionId",
		);
		expect(() => assertTarget({ customerId: "" } as never)).toThrow(
			"requires a non-empty customerId or subscriptionId",
		);
	});
});

describe("snapshot parsing and serialization", () => {
	it("serializes and parses a valid snapshot roundtrip", () => {
		const serialized = serializeEntitlementsSnapshot(snapshot);
		const parsed = parseSerializedEntitlementsSnapshot(serialized);

		expect(parsed).toEqual(snapshot);
	});

	it("identifies expired snapshots correctly", () => {
		expect(isSnapshotExpired(snapshot, now)).toBe(false);
		expect(isSnapshotExpired(snapshot, now + 70_000)).toBe(true);
	});

	it("throws on invalid snapshot structures", () => {
		expect(() => parseEntitlementsSnapshot(null)).toThrow("expected an object");
		expect(() => parseEntitlementsSnapshot({})).toThrow("schemaVersion");
		expect(() =>
			parseEntitlementsSnapshot({
				schemaVersion: 1,
				generatedAt: "invalid",
				expiresAt: "invalid",
				entitlements: {},
			}),
		).toThrow("generatedAt");
		expect(() =>
			parseEntitlementsSnapshot({
				schemaVersion: 1,
				generatedAt: new Date().toISOString(),
				expiresAt: new Date().toISOString(),
			}),
		).toThrow("entitlements");
		expect(() =>
			parseEntitlementsSnapshot({
				schemaVersion: 1,
				generatedAt: new Date().toISOString(),
				expiresAt: new Date().toISOString(),
				entitlements: {
					bad: { featureId: "", isEnabled: true },
				},
			}),
		).toThrow("featureId");
	});
});
