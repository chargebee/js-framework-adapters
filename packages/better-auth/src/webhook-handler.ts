import type { GenericEndpointContext } from "@better-auth/core";
import {
	basicAuthValidator,
	type Subscription as ChargebeeSubscription,
	type Customer,
	WebhookAuthenticationError,
	type WebhookEvent,
	WebhookEventType,
} from "chargebee";
import {
	onSubscriptionComplete,
	onSubscriptionCreated,
	onSubscriptionDeleted,
	onSubscriptionUpdated,
} from "./hooks";
import type {
	ChargebeeOptions,
	ChargebeeWebhookEventBus,
	Logger,
	Subscription,
} from "./types";

/**
 * Context object that wraps better-auth context for webhook handlers
 */
export interface BetterAuthWebhookContext {
	context: Record<string, unknown>;
	adapter: {
		findOne: <T = unknown>(params: unknown) => Promise<T | null>;
		findMany: <T = unknown>(params: unknown) => Promise<T[]>;
		update: (params: unknown) => Promise<unknown>;
		deleteMany: (params: unknown) => Promise<void>;
		create: (params: unknown) => Promise<unknown>;
	};
	logger: Logger;
}

interface WebhookResponse {
	status(code: number): WebhookResponse;
	send(body: string): void;
}

/**
 * Builds the Basic Auth request validator for the Chargebee webhook handler,
 * or `undefined` when no credentials are configured.
 */
function buildRequestValidator(options: ChargebeeOptions) {
	return options.webhookUsername && options.webhookPassword
		? basicAuthValidator((username, password) => {
				return (
					username === options.webhookUsername &&
					password === options.webhookPassword
				);
			})
		: undefined;
}

/**
 * Chargebee event types the plugin processes. These are registered on the
 * publish handler so that every relevant event is forwarded to the event bus.
 */
const HANDLED_EVENT_TYPES = [
	WebhookEventType.SubscriptionCreated,
	WebhookEventType.SubscriptionActivated,
	WebhookEventType.SubscriptionChanged,
	WebhookEventType.SubscriptionRenewed,
	WebhookEventType.SubscriptionStarted,
	WebhookEventType.SubscriptionCancelled,
	WebhookEventType.SubscriptionScheduledCancellationRemoved,
	WebhookEventType.CustomerDeleted,
] as const;

/**
 * Dispatches a single validated Chargebee webhook event to the appropriate
 * subscription/customer hook.
 *
 * This contains the event-type to hook mapping and is shared by both the
 * synchronous webhook handler ({@link createWebhookHandler}) and the
 * asynchronous queue consumer ({@link createChargebeeWebhookProcessor}).
 *
 * @param event - The parsed Chargebee webhook event
 * @param endpointCtx - Better-auth endpoint context (provides adapter/logger to hooks)
 * @param ctx - Better-auth webhook context wrapper (used by customer deletion)
 * @param options - Chargebee plugin options
 */
export async function dispatchWebhookEvent(
	event: WebhookEvent,
	endpointCtx: GenericEndpointContext,
	ctx: BetterAuthWebhookContext,
	options: ChargebeeOptions,
): Promise<void> {
	// The event type is narrowed via the switch below, but `content` is a union
	// across all event types, so we read the subscription/customer fields the
	// subscription hooks need through a focused view.
	const content = event.content as {
		subscription?: ChargebeeSubscription;
		customer?: Customer;
	};

	switch (event.event_type) {
		case WebhookEventType.SubscriptionCreated: {
			if (content.subscription && content.customer) {
				await onSubscriptionCreated(
					endpointCtx,
					options,
					content.subscription,
					content.customer,
				);
			}
			return;
		}
		case WebhookEventType.SubscriptionActivated:
		case WebhookEventType.SubscriptionStarted: {
			if (content.subscription && content.customer) {
				await onSubscriptionComplete(
					endpointCtx,
					options,
					content.subscription,
					content.customer,
				);
			}
			return;
		}
		case WebhookEventType.SubscriptionChanged:
		case WebhookEventType.SubscriptionRenewed:
		case WebhookEventType.SubscriptionScheduledCancellationRemoved: {
			if (content.subscription && content.customer) {
				await onSubscriptionUpdated(
					endpointCtx,
					options,
					content.subscription,
					content.customer,
				);
			}
			return;
		}
		case WebhookEventType.SubscriptionCancelled: {
			if (content.subscription) {
				await onSubscriptionDeleted(endpointCtx, options, content.subscription);
			}
			return;
		}
		case WebhookEventType.CustomerDeleted: {
			await handleCustomerDeletion(
				event as unknown as WebhookEvent<WebhookEventType.CustomerDeleted>,
				ctx,
				options,
			);
			return;
		}
		default: {
			ctx.logger.info(`Unhandled Chargebee webhook event: ${event.event_type}`);
		}
	}
}

/**
 * Creates and configures a Chargebee webhook handler with typed event listeners
 * @param options - Chargebee plugin options
 * @param ctx - Better-auth context
 * @returns Configured webhook handler instance
 */
export function createWebhookHandler(
	options: ChargebeeOptions,
	ctx: BetterAuthWebhookContext,
	endpointCtx: GenericEndpointContext,
) {
	const cb = options.chargebeeClient;

	const handler = cb.webhooks.createHandler<Request, WebhookResponse>({
		requestValidator: buildRequestValidator(options),
	});

	/**
	 * Handle subscription events (created, activated, changed, renewed)
	 */
	handler.on(
		WebhookEventType.SubscriptionCreated,
		async ({ event, response }) => {
			await dispatchWebhookEvent(event, endpointCtx, ctx, options);
			response?.status(200).send("OK");
		},
	);

	handler.on(
		WebhookEventType.SubscriptionActivated,
		async ({ event, response }) => {
			await dispatchWebhookEvent(event, endpointCtx, ctx, options);
			response?.status(200).send("OK");
		},
	);

	handler.on(
		WebhookEventType.SubscriptionChanged,
		async ({ event, response }) => {
			await dispatchWebhookEvent(event, endpointCtx, ctx, options);
			response?.status(200).send("OK");
		},
	);

	handler.on(
		WebhookEventType.SubscriptionRenewed,
		async ({ event, response }) => {
			await dispatchWebhookEvent(event, endpointCtx, ctx, options);
			response?.status(200).send("OK");
		},
	);

	handler.on(
		WebhookEventType.SubscriptionStarted,
		async ({ event, response }) => {
			await dispatchWebhookEvent(event, endpointCtx, ctx, options);
			response?.status(200).send("OK");
		},
	);

	/**
	 * Handle subscription cancellation events
	 */
	handler.on(
		WebhookEventType.SubscriptionCancelled,
		async ({ event, response }) => {
			await dispatchWebhookEvent(event, endpointCtx, ctx, options);
			response?.status(200).send("OK");
		},
	);

	handler.on(
		WebhookEventType.SubscriptionScheduledCancellationRemoved,
		async ({ event, response }) => {
			await dispatchWebhookEvent(event, endpointCtx, ctx, options);
			response?.status(200).send("OK");
		},
	);

	/**
	 * Handle customer deletion events
	 */
	handler.on(WebhookEventType.CustomerDeleted, async ({ event, response }) => {
		await dispatchWebhookEvent(event, endpointCtx, ctx, options);
		response?.status(200).send("OK");
	});

	/**
	 * Handle unhandled events
	 */
	handler.on("unhandled_event", async ({ event, response }) => {
		ctx.logger.info(`Unhandled Chargebee webhook event: ${event.event_type}`);
		response?.status(200).send("OK");
	});

	/**
	 * Handle errors
	 */
	handler.on("error", (error: Error, { response }) => {
		const webhookResponse = response as WebhookResponse | undefined;
		if (error instanceof WebhookAuthenticationError) {
			ctx.logger.warn(
				`Webhook rejected: ${error.message}. Please verify webhookUsername and webhookPassword are correctly configured in your plugin options and that the webhook in Chargebee dashboard has matching Basic Auth credentials.`,
			);
			webhookResponse?.status(401).send("Unauthorized");
			return;
		}

		// Log other errors and send 200 to prevent Chargebee retries
		ctx.logger.error("Error processing webhook event:", error);
		webhookResponse?.status(200).send("OK");
	});

	return handler;
}

/**
 * Creates a Chargebee webhook handler that validates and parses incoming events
 * and forwards every event to the provided event bus instead of running the
 * DB-sync hooks inline.
 *
 * Used by the webhook endpoint when `options.webhookEventBus` is configured, so
 * events can be pushed onto an application queue and processed later via
 * `createChargebeeWebhookProcessor`.
 *
 * @param options - Chargebee plugin options
 * @param eventBus - Event bus that receives each validated, parsed event
 * @param logger - Logger used for unhandled-event and error reporting
 * @returns Configured webhook handler instance
 */
export function createWebhookPublishHandler(
	options: ChargebeeOptions,
	eventBus: ChargebeeWebhookEventBus,
	logger: Logger,
) {
	const cb = options.chargebeeClient;

	const handler = cb.webhooks.createHandler<Request, WebhookResponse>({
		requestValidator: buildRequestValidator(options),
	});

	for (const eventType of HANDLED_EVENT_TYPES) {
		handler.on(eventType, async ({ event, response }) => {
			await eventBus.publish(event);
			response?.status(200).send("OK");
		});
	}

	// Forward all other events too, so the application receives every webhook.
	handler.on("unhandled_event", async ({ event, response }) => {
		await eventBus.publish(event);
		response?.status(200).send("OK");
	});

	handler.on("error", (error: Error, { response }) => {
		const webhookResponse = response as WebhookResponse | undefined;
		if (error instanceof WebhookAuthenticationError) {
			logger.warn(
				`Webhook rejected: ${error.message}. Please verify webhookUsername and webhookPassword are correctly configured in your plugin options and that the webhook in Chargebee dashboard has matching Basic Auth credentials.`,
			);
			webhookResponse?.status(401).send("Unauthorized");
			return;
		}

		// Log other errors and send 200 to prevent Chargebee retries
		logger.error("Error processing webhook event:", error);
		webhookResponse?.status(200).send("OK");
	});

	return handler;
}

/**
 * Handle customer deletion events
 */
async function handleCustomerDeletion(
	event: WebhookEvent<WebhookEventType.CustomerDeleted>,
	ctx: BetterAuthWebhookContext,
	_options: ChargebeeOptions,
) {
	const content = event.content;
	const customer = content.customer;

	if (!customer) {
		ctx.logger.warn("Missing customer in deletion event");
		return;
	}

	// Delete all subscriptions for this customer
	const subscriptions = await ctx.adapter.findMany<Subscription>({
		model: "subscription",
		where: [
			{
				field: "chargebeeCustomerId",
				value: customer.id,
			},
		],
	});

	for (const subscription of subscriptions) {
		// Delete subscription items first (due to foreign key constraint)
		await ctx.adapter.deleteMany({
			model: "subscriptionItem",
			where: [{ field: "subscriptionId", value: subscription.id }],
		});

		// Delete subscription
		await ctx.adapter.deleteMany({
			model: "subscription",
			where: [{ field: "id", value: subscription.id }],
		});
	}

	// Clear chargebeeCustomerId from user or organization
	const customerType = customer.meta_data?.customerType;

	ctx.logger.info(
		`Clearing customer ${customer.id} from database (type: ${customerType})`,
	);

	// Try using metadata first
	if (customerType === "organization") {
		const organizationId = customer.meta_data?.organizationId;
		if (organizationId) {
			await ctx.adapter.update({
				model: "organization",
				update: { chargebeeCustomerId: null },
				where: [{ field: "id", value: organizationId }],
			});
			ctx.logger.info(
				`Cleared chargebeeCustomerId from organization ${organizationId}`,
			);
		}
	} else if (customerType === "user") {
		const userId = customer.meta_data?.userId;
		if (userId) {
			await ctx.adapter.update({
				model: "user",
				update: { chargebeeCustomerId: null },
				where: [{ field: "id", value: userId }],
			});
			ctx.logger.info(`Cleared chargebeeCustomerId from user ${userId}`);
		}
	}

	// Fallback: Find user/org by chargebeeCustomerId directly
	// This handles cases where metadata is missing or incorrect.
	// Skip user fallback in org mode — the chargebeeCustomerId column does not
	// exist on the user table when organization.enabled is true.
	if (!_options.organization?.enabled) {
		try {
			const users = await ctx.adapter.findMany<{ id: string }>({
				model: "user",
				where: [
					{
						field: "chargebeeCustomerId",
						value: customer.id,
					},
				],
			});

			for (const user of users) {
				await ctx.adapter.update({
					model: "user",
					update: { chargebeeCustomerId: null },
					where: [{ field: "id", value: user.id }],
				});
				ctx.logger.info(
					`Cleared chargebeeCustomerId from user ${user.id} (fallback)`,
				);
			}
		} catch (e) {
			ctx.logger.error("Error clearing chargebeeCustomerId from users:", e);
		}
	}

	// Try to clear organizations (if enabled)
	if (_options.organization?.enabled) {
		try {
			const organizations = await ctx.adapter.findMany<{ id: string }>({
				model: "organization",
				where: [
					{
						field: "chargebeeCustomerId",
						value: customer.id,
					},
				],
			});

			for (const org of organizations) {
				await ctx.adapter.update({
					model: "organization",
					update: { chargebeeCustomerId: null },
					where: [{ field: "id", value: org.id }],
				});
				ctx.logger.info(
					`Cleared chargebeeCustomerId from organization ${org.id} (fallback)`,
				);
			}
		} catch (e) {
			ctx.logger.error(
				"Error clearing chargebeeCustomerId from organizations:",
				e,
			);
		}
	}

	ctx.logger.info(
		`Customer ${customer.id} and associated data deleted successfully`,
	);
}
