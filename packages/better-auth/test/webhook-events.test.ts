import type Chargebee from "chargebee";
import {
	WebhookAuthenticationError,
	type WebhookEvent,
	WebhookEventType,
} from "chargebee";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChargebeeOptions } from "../src/types";
import { createWebhookHandler } from "../src/webhook-handler";

describe("webhook handler - event processing", () => {
	const mockContext = {
		context: {},
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

	const mockEndpointCtx = {
		context: {
			adapter: mockContext.adapter,
			logger: mockContext.logger,
		},
	} as any;

	let mockHandlerInstance: {
		on: ReturnType<typeof vi.fn>;
		handle: ReturnType<typeof vi.fn>;
	};

	const mockChargebee = {
		webhooks: {
			createHandler: vi.fn(),
		},
	} as unknown as Chargebee;

	const mockOptions: ChargebeeOptions = {
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
				{
					name: "Premium Plan",
					itemPriceId: "plan-USD-yearly",
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

	describe("handleSubscriptionEvent", () => {
	it("should create subscription when not found", async () => {
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

	// Mock that subscription doesn't exist yet
	mockContext.adapter.findOne = vi.fn()
		.mockResolvedValueOnce(null) // First call: check if subscription exists
		.mockResolvedValueOnce({ id: "user_123", email: "test@example.com", chargebeeCustomerId: "cust_123" }); // Second call: find user

	mockContext.adapter.create = vi.fn()
		.mockResolvedValueOnce({ id: "local_sub_123" }) // Create subscription
		.mockResolvedValue({ id: "item_123" }); // Create subscription items

		createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

		const onHandler = mockHandlerInstance.on.mock.calls.find(
			(call) => call[0] === WebhookEventType.SubscriptionCreated,
		);
		expect(onHandler).toBeDefined();

		if (onHandler) {
			const eventHandler = onHandler[1];
			await eventHandler({
				event: mockEvent,
				response: {
					status: vi.fn().mockReturnThis(),
					send: vi.fn(),
				},
			});

			expect(mockContext.adapter.findOne).toHaveBeenCalledWith({
				model: "subscription",
				where: [
					{
						field: "chargebeeSubscriptionId",
						value: "sub_123",
					},
				],
			});

			expect(mockContext.adapter.create).toHaveBeenCalled();
		}
	});

	it("should find subscription by metadata subscriptionId", async () => {
		const mockEvent: WebhookEvent<WebhookEventType.SubscriptionActivated> = {
			id: "ev_123",
			occurred_at: 1234567890,
			source: "scheduled",
			object: "event",
			api_version: "v2",
			event_type: "subscription_activated" as WebhookEventType.SubscriptionActivated,
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
					meta_data: {
						subscriptionId: "local_sub_456",
					},
				},
				customer: {
					id: "cust_123",
					email: "test@example.com",
					object: "customer",
				},
			},
		};

		mockContext.adapter.findOne = vi
			.fn()
			.mockResolvedValueOnce(null) // First call by chargebeeSubscriptionId
			.mockResolvedValueOnce({
				// Second call by metadata subscriptionId
				id: "local_sub_456",
				referenceId: "user_123",
			});

		mockContext.adapter.update = vi.fn().mockResolvedValue({});

		createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

		const onHandler = mockHandlerInstance.on.mock.calls.find(
			(call) => call[0] === WebhookEventType.SubscriptionActivated,
		);

		if (onHandler) {
			const eventHandler = onHandler[1];
			await eventHandler({
				event: mockEvent,
				response: {
					status: vi.fn().mockReturnThis(),
					send: vi.fn(),
				},
			});

			expect(mockContext.adapter.findOne).toHaveBeenCalledTimes(2);
			expect(mockContext.adapter.update).toHaveBeenCalled();
		}
	});

	it("should warn when subscription found but no items to sync", async () => {
		const mockEvent: WebhookEvent<WebhookEventType.SubscriptionChanged> = {
			id: "ev_123",
			occurred_at: 1234567890,
			source: "scheduled",
			object: "event",
			api_version: "v2",
			event_type: "subscription_changed" as WebhookEventType.SubscriptionChanged,
			webhook_status: "scheduled",
			content: {
				subscription: {
					id: "sub_123",
					customer_id: "cust_123",
					status: "active",
					current_term_start: 1234567890,
					current_term_end: 1267103890,
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
			id: "local_sub_789",
			referenceId: "user_123",
			chargebeeSubscriptionId: "sub_123",
		});

		createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

		const onHandler = mockHandlerInstance.on.mock.calls.find(
			(call) => call[0] === WebhookEventType.SubscriptionChanged,
		);

		if (onHandler) {
			const eventHandler = onHandler[1];
			await eventHandler({
				event: mockEvent,
				response: {
					status: vi.fn().mockReturnThis(),
					send: vi.fn(),
				},
			});

		// Should not call adapter when subscription has no items
		expect(mockContext.adapter.findOne).not.toHaveBeenCalled();
		expect(mockContext.logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Subscription sub_123 has no items"),
		);
	}
});

	it("should skip processing when subscription or customer is missing", async () => {
		const mockEvent: WebhookEvent<WebhookEventType.SubscriptionCreated> = {
			id: "ev_123",
			occurred_at: 1234567890,
			source: "scheduled",
			object: "event",
			api_version: "v2",
			event_type: "subscription_created" as WebhookEventType.SubscriptionCreated,
			webhook_status: "scheduled",
			content: {} as never,
		};

		createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

		const onHandler = mockHandlerInstance.on.mock.calls.find(
			(call) => call[0] === WebhookEventType.SubscriptionCreated,
		);

		if (onHandler) {
			const eventHandler = onHandler[1];
			await eventHandler({
				event: mockEvent,
				response: {
					status: vi.fn().mockReturnThis(),
					send: vi.fn(),
				},
			});

			// Should not call adapter when subscription/customer is missing
			expect(mockContext.adapter.findOne).not.toHaveBeenCalled();
			expect(mockContext.adapter.create).not.toHaveBeenCalled();
		}
	});

		it("should warn when subscription not found and no referenceId in metadata", async () => {
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
						object: "subscription",
					},
					customer: {
						id: "cust_123",
						email: "test@example.com",
						object: "customer",
					},
				},
			};

			mockContext.adapter.findOne = vi.fn().mockResolvedValue(null);

			createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

			const onHandler = mockHandlerInstance.on.mock.calls.find(
				(call) => call[0] === WebhookEventType.SubscriptionCreated,
			);

			if (onHandler) {
				const eventHandler = onHandler[1];
				await eventHandler({
					event: mockEvent,
					response: {
						status: vi.fn().mockReturnThis(),
						send: vi.fn(),
					},
				});

		expect(mockContext.logger.warn).toHaveBeenCalled();
		const warnCall = mockContext.logger.warn.mock.calls[0];
		expect(warnCall[0]).toContain("No user or organization found");
		}
	});

	it("should sync subscription items with trial dates", async () => {
		const mockEvent: WebhookEvent<WebhookEventType.SubscriptionChanged> = {
			id: "ev_123",
			occurred_at: 1234567890,
			source: "scheduled",
			object: "event",
			api_version: "v2",
			event_type: "subscription_changed" as WebhookEventType.SubscriptionChanged,
			webhook_status: "scheduled",
			content: {
				subscription: {
					id: "sub_123",
					customer_id: "cust_123",
					status: "in_trial",
					current_term_start: 1234567890,
					current_term_end: 1267103890,
					trial_start: 1234567890,
					trial_end: 1237159890,
					object: "subscription",
					subscription_items: [
						{
							item_price_id: "plan-USD-monthly",
							item_type: "plan",
							quantity: 1,
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

		mockContext.adapter.findOne = vi.fn().mockResolvedValue({
			id: "local_sub_123",
			referenceId: "user_123",
			chargebeeSubscriptionId: "sub_123",
			status: "active",
		});

		mockContext.adapter.update = vi.fn().mockResolvedValue({});
		mockContext.adapter.deleteMany = vi.fn().mockResolvedValue({});
		mockContext.adapter.create = vi.fn().mockResolvedValue({});

		createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

		const onHandler = mockHandlerInstance.on.mock.calls.find(
			(call) => call[0] === WebhookEventType.SubscriptionChanged,
		);

		if (onHandler) {
			const eventHandler = onHandler[1];
			await eventHandler({
				event: mockEvent,
				response: {
					status: vi.fn().mockReturnThis(),
					send: vi.fn(),
				},
			});

			expect(mockContext.adapter.update).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "subscription",
					update: expect.objectContaining({
						trialStart: expect.any(Date),
						trialEnd: expect.any(Date),
					}),
				}),
			);
		}
	});
	});

	describe("handleSubscriptionCancellation", () => {
		it("should update subscription when cancelled", async () => {
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
			});

			mockContext.adapter.update = vi.fn().mockResolvedValue({});

			createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

			const onHandler = mockHandlerInstance.on.mock.calls.find(
				(call) => call[0] === WebhookEventType.SubscriptionCancelled,
			);

			if (onHandler) {
				const eventHandler = onHandler[1];
				await eventHandler({
					event: mockEvent,
					response: {
						status: vi.fn().mockReturnThis(),
						send: vi.fn(),
					},
				});

				expect(mockContext.adapter.update).toHaveBeenCalledWith(
					expect.objectContaining({
						model: "subscription",
						update: expect.objectContaining({
							status: "cancelled",
						}),
					}),
				);
			}
		});

		it("should warn when subscription not found for cancellation", async () => {
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
						object: "subscription",
					},
					customer: {
						id: "cust_123",
						email: "test@example.com",
						object: "customer",
					},
				},
			};

			mockContext.adapter.findOne = vi.fn().mockResolvedValue(null);

			createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

			const onHandler = mockHandlerInstance.on.mock.calls.find(
				(call) => call[0] === WebhookEventType.SubscriptionCancelled,
			);

			if (onHandler) {
				const eventHandler = onHandler[1];
				await eventHandler({
					event: mockEvent,
					response: {
						status: vi.fn().mockReturnThis(),
						send: vi.fn(),
					},
				});

			expect(mockContext.logger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Subscription not found for subscriptionId"),
			);
		}
	});

	it("should call onSubscriptionDeleted callback", async () => {
			const onSubscriptionDeleted = vi.fn();
			const optionsWithCallback: ChargebeeOptions = {
				...mockOptions,
				subscription: {
					enabled: true,
					plans: [],
					onSubscriptionDeleted,
				},
			};

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
			});

		mockContext.adapter.update = vi.fn().mockResolvedValue({});

		createWebhookHandler(optionsWithCallback, mockContext, mockEndpointCtx);

		const onHandler = mockHandlerInstance.on.mock.calls.find(
				(call) => call[0] === WebhookEventType.SubscriptionCancelled,
			);

			if (onHandler) {
				const eventHandler = onHandler[1];
				await eventHandler({
					event: mockEvent,
					response: {
						status: vi.fn().mockReturnThis(),
						send: vi.fn(),
					},
				});

				expect(onSubscriptionDeleted).toHaveBeenCalled();
			}
		});
	});

	describe("handleCustomerDeletion", () => {
		it("should delete subscriptions and clear chargebeeCustomerId from user", async () => {
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

			createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

			const onHandler = mockHandlerInstance.on.mock.calls.find(
				(call) => call[0] === WebhookEventType.CustomerDeleted,
			);

			if (onHandler) {
				const eventHandler = onHandler[1];
				await eventHandler({
					event: mockEvent,
					response: {
						status: vi.fn().mockReturnThis(),
						send: vi.fn(),
					},
				});

				expect(mockContext.adapter.findMany).toHaveBeenCalled();
				expect(mockContext.adapter.deleteMany).toHaveBeenCalled();
				expect(mockContext.adapter.update).toHaveBeenCalledWith(
					expect.objectContaining({
						model: "user",
						update: { chargebeeCustomerId: null },
					}),
				);
			}
		});

		it("should clear chargebeeCustomerId from organization", async () => {
			const optionsWithOrg: ChargebeeOptions = {
				...mockOptions,
				organization: {
					enabled: true,
				},
			};

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
							customerType: "organization",
							organizationId: "org_456",
						},
					},
				},
			};

		mockContext.adapter.findMany = vi.fn().mockResolvedValue([]);
		mockContext.adapter.update = vi.fn().mockResolvedValue({});

		createWebhookHandler(optionsWithOrg, mockContext, mockEndpointCtx);

		const onHandler = mockHandlerInstance.on.mock.calls.find(
			(call) => call[0] === WebhookEventType.CustomerDeleted,
			);

			if (onHandler) {
				const eventHandler = onHandler[1];
				await eventHandler({
					event: mockEvent,
					response: {
						status: vi.fn().mockReturnThis(),
						send: vi.fn(),
					},
				});

				expect(mockContext.adapter.update).toHaveBeenCalledWith(
					expect.objectContaining({
						model: "organization",
						update: { chargebeeCustomerId: null },
					}),
				);
			}
		});

		it("should handle customer without metadata", async () => {
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
					},
				},
			};

			mockContext.adapter.findMany = vi.fn().mockResolvedValue([]);

			createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

			const onHandler = mockHandlerInstance.on.mock.calls.find(
				(call) => call[0] === WebhookEventType.CustomerDeleted,
			);

			if (onHandler) {
				const eventHandler = onHandler[1];
				await eventHandler({
					event: mockEvent,
					response: {
						status: vi.fn().mockReturnThis(),
						send: vi.fn(),
					},
				});

				// Should handle gracefully without error
				expect(mockContext.adapter.findMany).toHaveBeenCalledWith({
					model: "subscription",
					where: [
						{
							field: "chargebeeCustomerId",
							value: "cust_123",
						},
					],
				});
			}
		});
	});

	describe("error handling", () => {
		it("should handle WebhookAuthenticationError", async () => {
			const error = new WebhookAuthenticationError("Invalid credentials");
			const mockResponse = {
				status: vi.fn().mockReturnThis(),
				send: vi.fn(),
			};

			createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

			const onErrorHandler = mockHandlerInstance.on.mock.calls.find(
				(call) => call[0] === "error",
			);

			if (onErrorHandler) {
				const errorHandler = onErrorHandler[1];
				errorHandler(error, { response: mockResponse });

				expect(mockContext.logger.warn).toHaveBeenCalledWith(
					expect.stringContaining("Webhook rejected"),
				);
				expect(mockResponse.status).toHaveBeenCalledWith(401);
				expect(mockResponse.send).toHaveBeenCalledWith("Unauthorized");
			}
		});

		it("should handle generic errors", async () => {
			const error = new Error("Something went wrong");
			const mockResponse = {
				status: vi.fn().mockReturnThis(),
				send: vi.fn(),
			};

			createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

			const onErrorHandler = mockHandlerInstance.on.mock.calls.find(
				(call) => call[0] === "error",
			);

			if (onErrorHandler) {
				const errorHandler = onErrorHandler[1];
				errorHandler(error, { response: mockResponse });

				expect(mockContext.logger.error).toHaveBeenCalledWith(
					"Error processing webhook event:",
					error,
				);
				expect(mockResponse.status).toHaveBeenCalledWith(200);
				expect(mockResponse.send).toHaveBeenCalledWith("OK");
			}
		});

		it("should handle error without response object", async () => {
			const error = new Error("No response");

			createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

			const onErrorHandler = mockHandlerInstance.on.mock.calls.find(
				(call) => call[0] === "error",
			);

			if (onErrorHandler) {
				const errorHandler = onErrorHandler[1];
				errorHandler(error, { response: undefined });

				expect(mockContext.logger.error).toHaveBeenCalledWith(
					"Error processing webhook event:",
					error,
				);
			}
		});
	});

	describe("unhandled events", () => {
		it("should log unhandled event type", async () => {
			const mockEvent = {
				id: "ev_unknown",
				occurred_at: 1234567890,
				source: "scheduled",
				object: "event",
				api_version: "v2",
				event_type: "payment_succeeded",
				webhook_status: "scheduled",
				content: {},
			};

			createWebhookHandler(mockOptions, mockContext, mockEndpointCtx);

			const onHandler = mockHandlerInstance.on.mock.calls.find(
				(call) => call[0] === "unhandled_event",
			);

			if (onHandler) {
				const eventHandler = onHandler[1];
				await eventHandler({
					event: mockEvent,
					response: {
						status: vi.fn().mockReturnThis(),
						send: vi.fn(),
					},
				});

				expect(mockContext.logger.info).toHaveBeenCalledWith(
					expect.stringContaining("Unhandled Chargebee webhook event"),
				);
			}
		});
	});
});
