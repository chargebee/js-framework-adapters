import type Chargebee from "chargebee";
import { describe, expect, it } from "vitest";
import { getSchema } from "../src/schema";
import type { ChargebeeOptions } from "../src/types";

const basePlans = [
	{ name: "pro", itemPriceId: "pro-USD-Monthly", type: "plan" as const },
];

describe("schema - getSchema", () => {
	it("should include user schema and omit subscription schemas when subscription is not enabled", () => {
		const options: ChargebeeOptions = {
			chargebeeClient: {} as Chargebee,
		};

		const schema = getSchema(options);

		expect(schema.user).toBeDefined();
		expect(schema.user.fields.chargebeeCustomerId).toEqual({
			type: "string",
			required: false,
			unique: true,
		});

		expect(schema).not.toHaveProperty("subscription");
		expect(schema).not.toHaveProperty("subscriptionItem");
		expect(schema).not.toHaveProperty("organization");
	});

	it("should include subscription schemas when subscription is enabled", () => {
		const options: ChargebeeOptions = {
			chargebeeClient: {} as Chargebee,
			subscription: { enabled: true, plans: basePlans },
		};

		const schema = getSchema(options);

		expect(schema.user).toBeDefined();
		expect(schema.subscription).toBeDefined();
		expect(schema.subscription.fields.referenceId).toEqual({
			type: "string",
			required: true,
		});
		expect(schema.subscriptionItem).toBeDefined();
		expect(schema.subscriptionItem.fields.subscriptionId).toEqual({
			type: "string",
			required: true,
			references: {
				model: "subscription",
				field: "id",
				onDelete: "cascade",
			},
		});
		expect(schema).not.toHaveProperty("organization");
	});

	it("should include organization schema and omit user schema when organization is enabled", () => {
		const options: ChargebeeOptions = {
			chargebeeClient: {} as Chargebee,
			subscription: { enabled: true, plans: basePlans },
			organization: { enabled: true },
		};

		const schema = getSchema(options);

		expect(schema).not.toHaveProperty("user");
		expect(schema.subscription).toBeDefined();
		expect(schema.subscriptionItem).toBeDefined();
		expect(schema.organization).toBeDefined();
		expect(schema.organization.fields.chargebeeCustomerId).toEqual({
			type: "string",
			required: false,
			unique: true,
		});
	});

	it("should have correct subscription field types", () => {
		const options: ChargebeeOptions = {
			chargebeeClient: {} as Chargebee,
			subscription: { enabled: true, plans: basePlans },
		};

		const schema = getSchema(options);

		expect(schema.subscription.fields.chargebeeCustomerId).toEqual({
			type: "string",
			required: false,
		});
		expect(schema.subscription.fields.chargebeeSubscriptionId).toEqual({
			type: "string",
			required: false,
			unique: true,
		});
		expect(schema.subscription.fields.status).toEqual({
			type: "string",
			required: false,
			defaultValue: "future",
		});
		expect(schema.subscription.fields.periodStart).toEqual({
			type: "date",
			required: false,
		});
		expect(schema.subscription.fields.periodEnd).toEqual({
			type: "date",
			required: false,
		});
		expect(schema.subscription.fields.trialStart).toEqual({
			type: "date",
			required: false,
		});
		expect(schema.subscription.fields.trialEnd).toEqual({
			type: "date",
			required: false,
		});
		expect(schema.subscription.fields.canceledAt).toEqual({
			type: "date",
			required: false,
		});
		expect(schema.subscription.fields.seats).toEqual({
			type: "number",
			required: false,
		});
		expect(schema.subscription.fields.metadata).toEqual({
			type: "string",
			required: false,
		});
	});

	it("should have correct subscription item field types", () => {
		const options: ChargebeeOptions = {
			chargebeeClient: {} as Chargebee,
			subscription: { enabled: true, plans: basePlans },
		};

		const schema = getSchema(options);

		expect(schema.subscriptionItem.fields.itemPriceId).toEqual({
			type: "string",
			required: true,
		});
		expect(schema.subscriptionItem.fields.itemType).toEqual({
			type: "string",
			required: true,
		});
		expect(schema.subscriptionItem.fields.quantity).toEqual({
			type: "number",
			required: true,
		});
		expect(schema.subscriptionItem.fields.unitPrice).toEqual({
			type: "number",
			required: false,
		});
		expect(schema.subscriptionItem.fields.amount).toEqual({
			type: "number",
			required: false,
		});
	});

	it("should not include organization schema when organization is not enabled", () => {
		const options: ChargebeeOptions = {
			chargebeeClient: {} as Chargebee,
			organization: undefined,
		};

		const schema = getSchema(options);

		expect(schema).not.toHaveProperty("organization");
	});

	it("should not include organization schema when organization is explicitly disabled", () => {
		const options: ChargebeeOptions = {
			chargebeeClient: {} as Chargebee,
			organization: { enabled: false },
		};

		const schema = getSchema(options);

		expect(schema).not.toHaveProperty("organization");
	});

	it("should omit user schema when organization is enabled", () => {
		const options: ChargebeeOptions = {
			chargebeeClient: {} as Chargebee,
			organization: { enabled: true },
		};

		const schema = getSchema(options);

		expect(schema).not.toHaveProperty("user");
		expect(schema).not.toHaveProperty("subscription");
		expect(schema).not.toHaveProperty("subscriptionItem");
		expect(schema.organization).toBeDefined();
	});
});
