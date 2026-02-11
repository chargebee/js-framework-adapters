import type { Auth } from "better-auth";
import { getTestInstance } from "better-auth/test";
import type Chargebee from "chargebee";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ChargebeePlugin } from "../src";
import { chargebee } from "../src";
import { chargebeeClient } from "../src/client";
import { CHARGEBEE_ERROR_CODES } from "../src/error-codes";
import { customerMetadata } from "../src/metadata";
import type { ChargebeeOptions, Subscription } from "../src/types";

describe("chargebee types", () => {
	it("should have api endpoints", () => {
		type Plugins = [
			ChargebeePlugin<{
				chargebeeClient: Chargebee;
				webhookUsername?: string;
				webhookPassword?: string;
			}>,
		];
		type MyAuth = Auth<{
			plugins: Plugins;
		}>;
		expectTypeOf<MyAuth["api"]["chargebeeWebhook"]>().toBeFunction();
	});

	it("should have subscription endpoints when enabled", () => {
		type Plugins = [
			ChargebeePlugin<{
				chargebeeClient: Chargebee;
				subscription: {
					enabled: true;
					plans: [];
				};
			}>,
		];
		type MyAuth = Auth<{
			plugins: Plugins;
		}>;
		expectTypeOf<MyAuth["api"]["chargebeeWebhook"]>().toBeFunction();
		expectTypeOf<MyAuth["api"]["upgradeSubscription"]>().toBeFunction();
		expectTypeOf<MyAuth["api"]["cancelSubscription"]>().toBeFunction();
		expectTypeOf<
			MyAuth["api"]["cancelSubscriptionCallback"]
		>().toBeFunction();
	});

	it("should infer plugin schema fields on user type", async () => {
		const { auth } = await getTestInstance({
			plugins: [
				chargebee({
					chargebeeClient: {} as Chargebee,
				}),
			],
		});
		expectTypeOf<
			(typeof auth)["$Infer"]["Session"]["user"]["chargebeeCustomerId"]
		>().toEqualTypeOf<string | null | undefined>();
	});

	it("should infer plugin schema fields alongside additional user fields", async () => {
		const { auth } = await getTestInstance({
			plugins: [
				chargebee({
					chargebeeClient: {} as Chargebee,
				}),
			],
			user: {
				additionalFields: {
					customField: {
						type: "string",
						required: false,
					},
				},
			},
		});
		expectTypeOf<
			(typeof auth)["$Infer"]["Session"]["user"]["chargebeeCustomerId"]
		>().toEqualTypeOf<string | null | undefined>();
		expectTypeOf<
			(typeof auth)["$Infer"]["Session"]["user"]["customField"]
		>().toEqualTypeOf<string | null | undefined>();
	});
});

describe("chargebee - metadata helpers", () => {
	it("customerMetadata.get extracts typed fields", () => {
		const result = customerMetadata.get({
			userId: "u1",
			customerType: "organization",
			extra: "ignored",
		});
		expect(result.userId).toBe("u1");
		expect(result.customerType).toBe("organization");
		expect(result).not.toHaveProperty("extra");
	});
});

describe("chargebee - error codes", () => {
	it("should export all error codes", () => {
		expect(CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED).toBeDefined();
		expect(CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND).toBeDefined();
		expect(CHARGEBEE_ERROR_CODES.PLAN_NOT_FOUND).toBeDefined();
		expect(CHARGEBEE_ERROR_CODES.CUSTOMER_NOT_FOUND).toBeDefined();
		expect(CHARGEBEE_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED).toBeDefined();
		expect(CHARGEBEE_ERROR_CODES.UNAUTHORIZED_REFERENCE).toBeDefined();
	});

	it("should have descriptive error messages", () => {
		expect(typeof CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED).toBe("string");
		expect(CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED.length).toBeGreaterThan(
			10,
		);
	});
});


describe("chargebee - client plugin", () => {
	it("should export client plugin", () => {
		expect(chargebeeClient).toBeDefined();
		expect(typeof chargebeeClient).toBe("function");
	});

	it("should have correct plugin id", () => {
		const plugin = chargebeeClient({ subscription: true });
		expect(plugin.id).toBe("chargebee-client");
	});

	it("should export error codes", () => {
		const plugin = chargebeeClient({ subscription: true });
		expect(plugin.$ERROR_CODES).toBeDefined();
		expect(plugin.$ERROR_CODES.ALREADY_SUBSCRIBED).toBeDefined();
	});

	it("should have path methods defined", () => {
		const plugin = chargebeeClient({ subscription: true });
		expect(plugin.pathMethods).toBeDefined();
		expect(plugin.pathMethods["/subscription/cancel"]).toBe("POST");
	});
});
