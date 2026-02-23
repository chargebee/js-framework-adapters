import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import type {
	ChargebeeCtxSession,
	ChargebeeOptions,
	ChargebeePlan,
	Subscription,
} from "../src/types";
import {
	getPlanByItemPriceId,
	getPlanByName,
	getPlans,
	getReferenceId,
	getUrl,
	isActiveOrTrialing,
	isPendingCancel,
} from "../src/utils";

describe("utils - getPlans", () => {
	it("should return empty array when subscription is undefined", async () => {
		const plans = await getPlans(undefined);
		expect(plans).toEqual([]);
	});

	it("should return empty array when plans is undefined", async () => {
		const plans = await getPlans({ enabled: true, plans: undefined } as never);
		expect(plans).toEqual([]);
	});

	it("should return plans array directly", async () => {
		const mockPlans: ChargebeePlan[] = [
			{ name: "Basic", itemPriceId: "basic-usd-monthly" },
			{ name: "Pro", itemPriceId: "pro-usd-monthly" },
		];

		const plans = await getPlans({ enabled: true, plans: mockPlans });
		expect(plans).toEqual(mockPlans);
	});

	it("should call plans function and return result", async () => {
		const mockPlans: ChargebeePlan[] = [
			{ name: "Basic", itemPriceId: "basic-usd-monthly" },
		];

		const plans = await getPlans({
			enabled: true,
			plans: async () => mockPlans,
		});
		expect(plans).toEqual(mockPlans);
	});
});

describe("utils - getPlanByName", () => {
	const mockPlans: ChargebeePlan[] = [
		{ name: "Basic", itemPriceId: "basic-usd-monthly" },
		{ name: "Pro", itemPriceId: "pro-usd-monthly" },
	];

	it("should find plan by exact name", async () => {
		const options = {
			chargebeeClient: {} as never,
			subscription: { enabled: true, plans: mockPlans },
		} as ChargebeeOptions;

		const plan = await getPlanByName(options, "Basic");
		expect(plan).toEqual(mockPlans[0]);
	});

	it("should find plan by name case-insensitive", async () => {
		const options = {
			chargebeeClient: {} as never,
			subscription: { enabled: true, plans: mockPlans },
		} as ChargebeeOptions;

		const plan = await getPlanByName(options, "BASIC");
		expect(plan).toEqual(mockPlans[0]);
	});

	it("should return undefined for non-existent plan", async () => {
		const options = {
			chargebeeClient: {} as never,
			subscription: { enabled: true, plans: mockPlans },
		} as ChargebeeOptions;

		const plan = await getPlanByName(options, "Enterprise");
		expect(plan).toBeUndefined();
	});
});

describe("utils - getPlanByItemPriceId", () => {
	const mockPlans: ChargebeePlan[] = [
		{ name: "Basic", itemPriceId: "basic-usd-monthly" },
		{ name: "Pro", itemPriceId: "pro-usd-monthly" },
	];

	it("should find plan by item price ID", async () => {
		const options = {
			chargebeeClient: {} as never,
			subscription: { enabled: true, plans: mockPlans },
		} as ChargebeeOptions;

		const plan = await getPlanByItemPriceId(options, "basic-usd-monthly");
		expect(plan).toEqual(mockPlans[0]);
	});

	it("should return undefined for non-existent item price ID", async () => {
		const options = {
			chargebeeClient: {} as never,
			subscription: { enabled: true, plans: mockPlans },
		} as ChargebeeOptions;

		const plan = await getPlanByItemPriceId(options, "non-existent");
		expect(plan).toBeUndefined();
	});
});

describe("utils - isActiveOrTrialing", () => {
	it("should return true for active subscription", () => {
		const subscription = { status: "active" } as Subscription;
		expect(isActiveOrTrialing(subscription)).toBe(true);
	});

	it("should return true for in_trial subscription", () => {
		const subscription = { status: "in_trial" } as Subscription;
		expect(isActiveOrTrialing(subscription)).toBe(true);
	});

	it("should return false for cancelled subscription", () => {
		const subscription = { status: "cancelled" } as Subscription;
		expect(isActiveOrTrialing(subscription)).toBe(false);
	});

	it("should return false for paused subscription", () => {
		const subscription = { status: "paused" } as Subscription;
		expect(isActiveOrTrialing(subscription)).toBe(false);
	});
});

describe("utils - isPendingCancel", () => {
	it("should return true when subscription is cancelled and period end is in future", () => {
		const subscription = {
			canceledAt: new Date(),
			periodEnd: new Date(Date.now() + 86400000), // tomorrow
		} as Subscription;
		expect(isPendingCancel(subscription)).toBe(true);
	});

	it("should return false when subscription is not cancelled", () => {
		const subscription = {
			canceledAt: null,
			periodEnd: new Date(Date.now() + 86400000),
		} as Subscription;
		expect(isPendingCancel(subscription)).toBe(false);
	});

	it("should return false when period end is in the past", () => {
		const subscription = {
			canceledAt: new Date(),
			periodEnd: new Date(Date.now() - 86400000), // yesterday
		} as Subscription;
		expect(isPendingCancel(subscription)).toBe(false);
	});

	it("should return false when periodEnd is undefined", () => {
		const subscription = {
			canceledAt: new Date(),
			periodEnd: undefined,
		} as Subscription;
		expect(isPendingCancel(subscription)).toBe(false);
	});
});

describe("utils - getReferenceId", () => {
	it("should return user id for user type", () => {
		const ctxSession = {
			user: { id: "user_123" },
			session: {},
		} as ChargebeeCtxSession;

		const options = { chargebeeClient: {} as never } as ChargebeeOptions;

		const referenceId = getReferenceId(ctxSession, "user", options);
		expect(referenceId).toBe("user_123");
	});

	it("should return user id when customerType is undefined", () => {
		const ctxSession = {
			user: { id: "user_123" },
			session: {},
		} as ChargebeeCtxSession;

		const options = { chargebeeClient: {} as never } as ChargebeeOptions;

		const referenceId = getReferenceId(ctxSession, undefined, options);
		expect(referenceId).toBe("user_123");
	});

	it("should return active organization id for organization type", () => {
		const ctxSession = {
			user: { id: "user_123" },
			session: { activeOrganizationId: "org_456" },
		} as ChargebeeCtxSession;

		const options = {
			chargebeeClient: {} as never,
			organization: { enabled: true },
		} as ChargebeeOptions;

		const referenceId = getReferenceId(ctxSession, "organization", options);
		expect(referenceId).toBe("org_456");
	});

	it("should throw error if organization type but organization not enabled", () => {
		const ctxSession = {
			user: { id: "user_123" },
			session: { activeOrganizationId: "org_456" },
		} as ChargebeeCtxSession;

		const options = {
			chargebeeClient: {} as never,
		} as ChargebeeOptions;

		expect(() => getReferenceId(ctxSession, "organization", options)).toThrow(
			APIError,
		);
	});

	it("should throw error if organization type but no active organization", () => {
		const ctxSession = {
			user: { id: "user_123" },
			session: {},
		} as ChargebeeCtxSession;

		const options = {
			chargebeeClient: {} as never,
			organization: { enabled: true },
		} as ChargebeeOptions;

		expect(() => getReferenceId(ctxSession, "organization", options)).toThrow(
			APIError,
		);
	});
});

describe("utils - getUrl", () => {
	it("should return absolute URL as-is", () => {
		const ctx = {
			context: { baseURL: "https://example.com" },
		} as GenericEndpointContext;

		const url = getUrl(ctx, "https://other.com/path");
		expect(url).toBe("https://other.com/path");
	});

	it("should convert relative URL with leading slash", () => {
		const ctx = {
			context: { baseURL: "https://example.com" },
		} as GenericEndpointContext;

		const url = getUrl(ctx, "/path/to/resource");
		expect(url).toBe("https://example.com/path/to/resource");
	});

	it("should convert relative URL without leading slash", () => {
		const ctx = {
			context: { baseURL: "https://example.com" },
		} as GenericEndpointContext;

		const url = getUrl(ctx, "path/to/resource");
		expect(url).toBe("https://example.com/path/to/resource");
	});

	it("should handle different protocols", () => {
		const ctx = {
			context: { baseURL: "http://localhost:3000" },
		} as GenericEndpointContext;

		expect(getUrl(ctx, "http://external.com")).toBe("http://external.com");
		expect(getUrl(ctx, "https://external.com")).toBe("https://external.com");
		expect(getUrl(ctx, "ftp://files.com")).toBe("ftp://files.com");
	});
});
