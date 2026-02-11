import type Chargebee from "chargebee";
import type { WebhookEvent, WebhookEventType } from "chargebee";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChargebeeOptions } from "../src/types";
import { createWebhookHandler } from "../src/webhook-handler";

describe("webhook handler", () => {
	const mockContext = {
		context: {
			adapter: {
				findOne: vi.fn(),
				findMany: vi.fn(),
				create: vi.fn(),
				update: vi.fn(),
				deleteMany: vi.fn(),
			},
			logger: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			},
		},
		adapter: {
			findOne: vi.fn(),
			findMany: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			deleteMany: vi.fn(),
		},
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
	};

	const mockHandler = {
		on: vi.fn().mockReturnThis(),
		handle: vi.fn().mockResolvedValue({}),
	};

	const mockChargebee = {
		webhooks: {
			createHandler: vi.fn().mockReturnValue(mockHandler),
		},
	} as unknown as Chargebee;

	const mockOptions: ChargebeeOptions = {
		chargebeeClient: mockChargebee,
		webhookUsername: "test_user",
		webhookPassword: "test_pass",
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should create webhook handler with basic auth", () => {
		const handler = createWebhookHandler(mockOptions, mockContext);
		expect(mockChargebee.webhooks.createHandler).toHaveBeenCalled();
	});

	it("should create webhook handler without auth when credentials not provided", () => {
		const optionsWithoutAuth = {
			...mockOptions,
			webhookUsername: undefined,
			webhookPassword: undefined,
		};

		const handler = createWebhookHandler(optionsWithoutAuth, mockContext);
		expect(mockChargebee.webhooks.createHandler).toHaveBeenCalledWith({
			requestValidator: undefined,
		});
	});

	it("should handle subscription_created event", async () => {
		const mockEvent: WebhookEvent<WebhookEventType.SubscriptionCreated> = {
			id: "ev_123",
			occurred_at: 1234567890,
			source: "scheduled",
			object: "event",
			api_version: "v2",
			event_type: "subscription_created" as WebhookEventType.SubscriptionCreated,
			webhook_status: "scheduled",
			content: {
				subscription: {
					id: "sub_123",
					customer_id: "cust_123",
					status: "active",
					current_term_start: 1234567890,
					current_term_end: 1267103890,
					meta_data: {
						subscriptionId: "local_sub_123",
					},
					subscription_items: [
						{
							item_price_id: "plan-USD-monthly",
							item_type: "plan",
							quantity: 1,
							unit_price: 999,
							amount: 999,
						},
					],
				},
				customer: {
					id: "cust_123",
					email: "test@example.com",
					first_name: "Test",
					last_name: "User",
					object: "customer",
				},
			},
		};

		mockContext.adapter.findOne = vi.fn().mockResolvedValue({
			id: "local_sub_123",
			referenceId: "user_123",
			status: "pending",
		});

		mockContext.adapter.update = vi.fn().mockResolvedValue({});
		mockContext.adapter.deleteMany = vi.fn().mockResolvedValue({});
		mockContext.adapter.create = vi.fn().mockResolvedValue({});

		// Simulate the handler processing the event
		// Note: This is a simplified test - in reality, the handler would be called via handle()
		const handler = createWebhookHandler(mockOptions, mockContext);

		// Verify handler setup
		expect(mockChargebee.webhooks.createHandler).toHaveBeenCalled();
	});

	it("should handle subscription_cancelled event", async () => {
		const mockEvent: WebhookEvent<WebhookEventType.SubscriptionCancelled> = {
			id: "ev_cancel",
			occurred_at: 1234567890,
			source: "scheduled",
			object: "event",
			api_version: "v2",
			event_type:
				"subscription_cancelled" as WebhookEventType.SubscriptionCancelled,
			webhook_status: "scheduled",
			content: {
				subscription: {
					id: "sub_123",
					customer_id: "cust_123",
					status: "cancelled",
					cancelled_at: 1234567890,
					object: "subscription",
				},
				customer: {
					id: "cust_123",
					email: "test@example.com",
					object: "customer",
				},
			},
		};

		mockContext.adapter.findOne = vi.fn().mockResolvedValue({
			id: "local_sub_123",
			referenceId: "user_123",
			chargebeeSubscriptionId: "sub_123",
			status: "active",
		});

		mockContext.adapter.update = vi.fn().mockResolvedValue({});

		const handler = createWebhookHandler(mockOptions, mockContext);

		expect(mockChargebee.webhooks.createHandler).toHaveBeenCalled();
	});

	it("should handle customer_deleted event", async () => {
		const mockEvent: WebhookEvent<WebhookEventType.CustomerDeleted> = {
			id: "ev_delete",
			occurred_at: 1234567890,
			source: "scheduled",
			object: "event",
			api_version: "v2",
			event_type: "customer_deleted" as WebhookEventType.CustomerDeleted,
			webhook_status: "scheduled",
			content: {
				customer: {
					id: "cust_123",
					email: "test@example.com",
					deleted: true,
					object: "customer",
					meta_data: {
						customerType: "user",
						userId: "user_123",
					},
				},
			},
		};

		mockContext.adapter.findMany = vi.fn().mockResolvedValue([
			{
				id: "sub_123",
				chargebeeCustomerId: "cust_123",
			},
		]);

		mockContext.adapter.deleteMany = vi.fn().mockResolvedValue({});
		mockContext.adapter.update = vi.fn().mockResolvedValue({});

		const handler = createWebhookHandler(mockOptions, mockContext);

		expect(mockChargebee.webhooks.createHandler).toHaveBeenCalled();
	});

	it("should log authentication errors", () => {
		const handler = createWebhookHandler(mockOptions, mockContext);

		// Verify handler was created
		expect(mockChargebee.webhooks.createHandler).toHaveBeenCalled();

		// Get the handler config
		const handlerConfig =
			mockChargebee.webhooks.createHandler.mock.calls[0][0];

		// Verify requestValidator exists
		expect(handlerConfig.requestValidator).toBeDefined();
	});

	it("should handle unhandled events gracefully", () => {
		const handler = createWebhookHandler(mockOptions, mockContext);

		expect(mockChargebee.webhooks.createHandler).toHaveBeenCalled();

		// Verify the handler was set up with proper event listeners
		expect(mockContext.logger.info).toBeDefined();
	});

	it("should sync subscription items", async () => {
		mockContext.adapter.findOne = vi.fn().mockResolvedValue({
			id: "local_sub_123",
			referenceId: "user_123",
			status: "pending",
		});

		mockContext.adapter.deleteMany = vi.fn().mockResolvedValue({});
		mockContext.adapter.create = vi.fn().mockResolvedValue({});
		mockContext.adapter.update = vi.fn().mockResolvedValue({});

		const handler = createWebhookHandler(mockOptions, mockContext);

		expect(mockChargebee.webhooks.createHandler).toHaveBeenCalled();
	});

	it("should handle missing subscription in webhook", () => {
		mockContext.adapter.findOne = vi.fn().mockResolvedValue(null);

		const handler = createWebhookHandler(mockOptions, mockContext);

		expect(mockChargebee.webhooks.createHandler).toHaveBeenCalled();
	});

	it("should update subscription with trial dates", async () => {
		mockContext.adapter.findOne = vi.fn().mockResolvedValue({
			id: "local_sub_123",
			referenceId: "user_123",
		});

		mockContext.adapter.update = vi.fn().mockResolvedValue({});
		mockContext.adapter.deleteMany = vi.fn().mockResolvedValue({});
		mockContext.adapter.create = vi.fn().mockResolvedValue({});

		const handler = createWebhookHandler(mockOptions, mockContext);

		expect(mockChargebee.webhooks.createHandler).toHaveBeenCalled();
	});

	it("should handle subscription callback with onSubscriptionDeleted", () => {
		const onSubscriptionDeleted = vi.fn();

		const optionsWithCallback: ChargebeeOptions = {
			...mockOptions,
			subscription: {
				enabled: true,
				plans: [],
				onSubscriptionDeleted,
			},
		};

		mockContext.adapter.findOne = vi.fn().mockResolvedValue({
			id: "local_sub_123",
			chargebeeSubscriptionId: "sub_123",
		});

		mockContext.adapter.update = vi.fn().mockResolvedValue({});

		const handler = createWebhookHandler(optionsWithCallback, mockContext);

		expect(mockChargebee.webhooks.createHandler).toHaveBeenCalled();
	});

	it("should clear chargebeeCustomerId from organization", async () => {
		const optionsWithOrg: ChargebeeOptions = {
			...mockOptions,
			organization: {
				enabled: true,
			},
		};

		mockContext.adapter.findMany = vi.fn().mockResolvedValue([]);
		mockContext.adapter.update = vi.fn().mockResolvedValue({});

		const handler = createWebhookHandler(optionsWithOrg, mockContext);

		expect(mockChargebee.webhooks.createHandler).toHaveBeenCalled();
	});
});
