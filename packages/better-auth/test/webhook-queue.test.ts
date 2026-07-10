import type Chargebee from "chargebee";
import { type WebhookEvent, WebhookEventType } from "chargebee";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChargebeeOptions, ChargebeeWebhookEventBus } from "../src/types";
import { createWebhookPublishHandler } from "../src/webhook-handler";
import { createChargebeeWebhookProcessor } from "../src/webhook-processor";

const createdEvent: WebhookEvent<WebhookEventType.SubscriptionCreated> = {
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
			object: "subscription",
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
			object: "customer",
		},
	},
};

describe("webhook event bus / queue", () => {
	let mockHandlerInstance: {
		on: ReturnType<typeof vi.fn>;
		handle: ReturnType<typeof vi.fn>;
	};

	const mockChargebee = {
		webhooks: {
			createHandler: vi.fn(),
		},
	} as unknown as Chargebee;

	const logger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};

	const baseOptions: ChargebeeOptions = {
		chargebeeClient: mockChargebee,
		webhookUsername: "test_user",
		webhookPassword: "test_pass",
		subscription: {
			enabled: true,
			plans: [
				{
					name: "Basic Plan",
					itemPriceId: "plan-USD-monthly",
					type: "plan" as const,
				},
			],
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockHandlerInstance = {
			on: vi.fn().mockReturnThis(),
			handle: vi.fn().mockResolvedValue({}),
		};
		mockChargebee.webhooks.createHandler = vi
			.fn()
			.mockReturnValue(mockHandlerInstance);
	});

	describe("createWebhookPublishHandler", () => {
		it("publishes parsed events to the bus instead of touching the adapter", async () => {
			const eventBus: ChargebeeWebhookEventBus = {
				publish: vi.fn().mockResolvedValue(undefined),
			};

			createWebhookPublishHandler(baseOptions, eventBus, logger);

			const onHandler = mockHandlerInstance.on.mock.calls.find(
				(call) => call[0] === WebhookEventType.SubscriptionCreated,
			);
			expect(onHandler).toBeDefined();

			const response = {
				status: vi.fn().mockReturnThis(),
				send: vi.fn(),
			};
			await onHandler?.[1]({ event: createdEvent, response });

			expect(eventBus.publish).toHaveBeenCalledWith(createdEvent);
			expect(response.status).toHaveBeenCalledWith(200);
		});

		it("forwards unhandled events to the bus too", async () => {
			const eventBus: ChargebeeWebhookEventBus = {
				publish: vi.fn().mockResolvedValue(undefined),
			};

			createWebhookPublishHandler(baseOptions, eventBus, logger);

			const onHandler = mockHandlerInstance.on.mock.calls.find(
				(call) => call[0] === "unhandled_event",
			);
			expect(onHandler).toBeDefined();

			const unknownEvent = {
				...createdEvent,
				event_type: "payment_succeeded",
			} as unknown as WebhookEvent;

			const response = {
				status: vi.fn().mockReturnThis(),
				send: vi.fn(),
			};
			await onHandler?.[1]({ event: unknownEvent, response });

			expect(eventBus.publish).toHaveBeenCalledWith(unknownEvent);
		});
	});

	describe("createChargebeeWebhookProcessor", () => {
		it("runs the matching hook using an explicit context", async () => {
			const adapter = {
				findOne: vi
					.fn()
					.mockResolvedValueOnce(null) // subscription doesn't exist
					.mockResolvedValueOnce({
						id: "user_123",
						email: "test@example.com",
						chargebeeCustomerId: "cust_123",
					}),
				findMany: vi.fn().mockResolvedValue([]),
				create: vi
					.fn()
					.mockResolvedValueOnce({ id: "local_sub_123" })
					.mockResolvedValue({ id: "item_123" }),
				update: vi.fn().mockResolvedValue({}),
				deleteMany: vi.fn().mockResolvedValue(undefined),
			};

			const processor = createChargebeeWebhookProcessor(baseOptions, {
				context: { adapter, logger },
			});

			await processor.process(createdEvent);

			expect(adapter.findOne).toHaveBeenCalledWith({
				model: "subscription",
				where: [{ field: "chargebeeSubscriptionId", value: "sub_123" }],
			});
			expect(adapter.create).toHaveBeenCalled();
		});

		it("resolves context lazily from an in-process auth instance", async () => {
			const adapter = {
				findOne: vi.fn().mockResolvedValue({
					id: "local_sub_123",
					referenceId: "user_123",
					chargebeeSubscriptionId: "sub_123",
				}),
				findMany: vi.fn().mockResolvedValue([]),
				create: vi.fn().mockResolvedValue({}),
				update: vi.fn().mockResolvedValue({}),
				deleteMany: vi.fn().mockResolvedValue(undefined),
			};

			const auth = {
				$context: Promise.resolve({ adapter, logger }),
			};

			const cancelEvent: WebhookEvent<WebhookEventType.SubscriptionCancelled> =
				{
					...createdEvent,
					event_type:
						"subscription_cancelled" as WebhookEventType.SubscriptionCancelled,
					content: {
						subscription: {
							id: "sub_123",
							customer_id: "cust_123",
							status: "cancelled",
							cancelled_at: 1234567890,
							object: "subscription",
						},
					},
				} as WebhookEvent<WebhookEventType.SubscriptionCancelled>;

			const processor = createChargebeeWebhookProcessor(baseOptions, { auth });
			await processor.process(cancelEvent);

			expect(adapter.update).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "subscription",
					update: expect.objectContaining({ status: "cancelled" }),
				}),
			);
		});

		it("logs and ignores unknown event types", async () => {
			const adapter = {
				findOne: vi.fn(),
				findMany: vi.fn(),
				create: vi.fn(),
				update: vi.fn(),
				deleteMany: vi.fn(),
			};

			const processor = createChargebeeWebhookProcessor(baseOptions, {
				context: { adapter, logger },
			});

			const unknownEvent = {
				...createdEvent,
				event_type: "payment_succeeded",
			} as unknown as WebhookEvent;

			await processor.process(unknownEvent);

			expect(adapter.findOne).not.toHaveBeenCalled();
			expect(logger.info).toHaveBeenCalledWith(
				expect.stringContaining("Unhandled Chargebee webhook event"),
			);
		});
	});
});
