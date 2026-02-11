import type Chargebee from "chargebee";
import type { WebhookEvent, WebhookEventType } from "chargebee";
import { basicAuthValidator } from "chargebee";
import type { ChargebeeOptions, SubscriptionOptions } from "./types";

/**
 * Context object that wraps better-auth context for webhook handlers
 */
interface BetterAuthWebhookContext {
	context: any;
	adapter: any;
	logger: any;
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
) {
	const cb = options.chargebeeClient;

	// Create handler with optional Basic Auth using Chargebee's validator
	const handler = (cb as Chargebee).webhooks.createHandler({
		requestValidator:
			options.webhookUsername && options.webhookPassword
				? basicAuthValidator((username, password) => {
						return (
							username === options.webhookUsername &&
							password === options.webhookPassword
						);
					})
				: undefined,
	});

	/**
	 * Handle subscription events (created, activated, changed, renewed)
	 */
	handler.on("subscription_created", async ({ event, response }: any) => {
		await handleSubscriptionEvent(event, ctx, options);
		response?.status(200).send("OK");
	});

	handler.on("subscription_activated", async ({ event, response }: any) => {
		await handleSubscriptionEvent(event, ctx, options);
		response?.status(200).send("OK");
	});

	handler.on("subscription_changed", async ({ event, response }: any) => {
		await handleSubscriptionEvent(event, ctx, options);
		response?.status(200).send("OK");
	});

	handler.on("subscription_renewed", async ({ event, response }: any) => {
		await handleSubscriptionEvent(event, ctx, options);
		response?.status(200).send("OK");
	});

	handler.on("subscription_started", async ({ event, response }: any) => {
		await handleSubscriptionEvent(event, ctx, options);
		response?.status(200).send("OK");
	});

	/**
	 * Handle subscription cancellation events
	 */
	handler.on("subscription_cancelled", async ({ event, response }: any) => {
		await handleSubscriptionCancellation(event, ctx, options);
		response?.status(200).send("OK");
	});

	handler.on(
		"subscription_cancellation_scheduled",
		async ({ event, response }: any) => {
			await handleSubscriptionCancellation(event, ctx, options);
			response?.status(200).send("OK");
		},
	);

	/**
	 * Handle customer deletion events
	 */
	handler.on("customer_deleted", async ({ event, response }: any) => {
		await handleCustomerDeletion(event, ctx, options);
		response?.status(200).send("OK");
	});

	/**
	 * Handle unhandled events
	 */
	handler.on("unhandled_event", async ({ event, response }: any) => {
		ctx.logger.info(`Unhandled Chargebee webhook event: ${event.event_type}`);
		response?.status(200).send("OK");
	});

	/**
	 * Handle errors
	 */
	handler.on("error", (error: Error, { response }: any) => {
		// Check if it's an authentication error from basicAuthValidator
		const authErrors = [
			"Missing authorization header",
			"Invalid authorization header",
			"Invalid authorization header format",
			"Invalid credentials format",
			"Invalid credentials",
		];

		if (authErrors.includes(error.message)) {
			ctx.logger.warn(
				`Webhook rejected: ${error.message}. Please verify webhookUsername and webhookPassword are correctly configured in your plugin options and that the webhook in Chargebee dashboard has matching Basic Auth credentials.`,
			);
			response?.status(400).send("Unauthorized");
		} else {
			ctx.logger.error("Error processing webhook event:", error);
			// Send 200 to prevent Chargebee retries for processing issues
			response?.status(200).send("OK");
		}
	});

	return handler;
}

/**
 * Handle subscription events (created, activated, changed, renewed)
 * Syncs subscription data and populates subscription items
 */
async function handleSubscriptionEvent(
	event:
		| WebhookEvent<WebhookEventType.SubscriptionCreated>
		| WebhookEvent<WebhookEventType.SubscriptionActivated>
		| WebhookEvent<WebhookEventType.SubscriptionChanged>
		| WebhookEvent<WebhookEventType.SubscriptionRenewed>
		| WebhookEvent<WebhookEventType.SubscriptionStarted>,
	ctx: BetterAuthWebhookContext,
	_options: ChargebeeOptions,
) {
	const content = event.content;
	const subscription = content.subscription;
	const customer = content.customer;

	if (!subscription || !customer) {
		ctx.logger.warn("Missing subscription or customer in webhook event");
		return;
	}

	// Log the metadata for debugging
	ctx.logger.info(
		`Processing subscription ${subscription.id} with metadata:`,
		subscription.meta_data,
	);

	// Find the subscription in our database by Chargebee subscription ID
	let dbSubscription = await ctx.adapter.findOne({
		model: "subscription",
		where: [
			{
				field: "chargebeeSubscriptionId",
				value: subscription.id,
			},
		],
	});

	// If not found by Chargebee ID, try to find by metadata subscriptionId
	if (!dbSubscription && subscription.meta_data?.subscriptionId) {
		ctx.logger.info(
			`Looking for subscription by ID: ${subscription.meta_data.subscriptionId}`,
		);
		dbSubscription = await ctx.adapter.findOne({
			model: "subscription",
			where: [
				{
					field: "id",
					value: subscription.meta_data.subscriptionId,
				},
			],
		});

		if (dbSubscription) {
			ctx.logger.info(
				`Found subscription by metadata ID: ${dbSubscription.id}`,
			);
		}
	}

	// If still not found, try to find by customer metadata (for hosted pages)
	if (!dbSubscription && customer.meta_data?.pendingSubscriptionId) {
		ctx.logger.info(
			`Looking for subscription by customer metadata: ${customer.meta_data.pendingSubscriptionId}`,
		);
		dbSubscription = await ctx.adapter.findOne({
			model: "subscription",
			where: [
				{
					field: "id",
					value: customer.meta_data.pendingSubscriptionId,
				},
			],
		});

		if (dbSubscription) {
			ctx.logger.info(
				`Found subscription via customer metadata: ${dbSubscription.id}`,
			);
		}
	}

	// If we found the subscription, update it with Chargebee data
	if (dbSubscription) {
		ctx.logger.info(
			`Updating subscription ${dbSubscription.id} with Chargebee subscription ID ${subscription.id}`,
		);

		await ctx.adapter.update({
			model: "subscription",
			update: {
				chargebeeSubscriptionId: subscription.id,
				chargebeeCustomerId: customer.id,
				status: subscription.status,
				periodStart: new Date((subscription.current_term_start || 0) * 1000),
				periodEnd: new Date((subscription.current_term_end || 0) * 1000),
				cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
				cancelAt: subscription.cancel_at
					? new Date((subscription.cancel_at as number) * 1000)
					: null,
				canceledAt: subscription.cancelled_at
					? new Date((subscription.cancelled_at as number) * 1000)
					: null,
				endedAt: subscription.ended_at
					? new Date((subscription.ended_at as number) * 1000)
					: null,
				trialStart: subscription.trial_start
					? new Date((subscription.trial_start as number) * 1000)
					: null,
				trialEnd: subscription.trial_end
					? new Date((subscription.trial_end as number) * 1000)
					: null,
				updatedAt: new Date(),
			},
			where: [{ field: "id", value: dbSubscription.id }],
		});

		ctx.logger.info(`Subscription ${dbSubscription.id} updated successfully`);
	} else {
		// If not found in database, check if we have referenceId in metadata
		const referenceId = subscription.meta_data?.referenceId;

		if (!referenceId) {
			ctx.logger.warn(
				`Cannot create subscription: missing referenceId in metadata. Subscription ID: ${subscription.id}, Metadata:`,
				JSON.stringify(subscription.meta_data),
			);
			return;
		}
	}

	// Sync subscription items
	if (dbSubscription && subscription.subscription_items) {
		// Delete existing subscription items
		await ctx.adapter.deleteMany({
			model: "subscriptionItem",
			where: [{ field: "subscriptionId", value: dbSubscription.id }],
		});

		// Create new subscription items
		for (const item of subscription.subscription_items) {
			await ctx.adapter.create({
				model: "subscriptionItem",
				data: {
					subscriptionId: dbSubscription.id,
					itemPriceId: item.item_price_id,
					itemType: item.item_type || "plan",
					quantity: item.quantity || 1,
					unitPrice: item.unit_price || null,
					amount: item.amount || null,
				},
			});
		}

		ctx.logger.info(
			`Synced ${subscription.subscription_items.length} subscription items for subscription ${dbSubscription.id}`,
		);
	}
}

/**
 * Handle subscription cancellation events
 */
async function handleSubscriptionCancellation(
	event:
		| WebhookEvent<WebhookEventType.SubscriptionCancelled>
		| WebhookEvent<WebhookEventType.SubscriptionCancellationScheduled>,
	ctx: BetterAuthWebhookContext,
	options: ChargebeeOptions,
) {
	const content = event.content;
	const subscription = content.subscription;

	if (!subscription) {
		ctx.logger.warn("Missing subscription in cancellation event");
		return;
	}

	const dbSubscription = await ctx.adapter.findOne({
		model: "subscription",
		where: [
			{
				field: "chargebeeSubscriptionId",
				value: subscription.id,
			},
		],
	});

	if (!dbSubscription) {
		ctx.logger.warn(
			`Subscription ${subscription.id} not found for cancellation`,
		);
		return;
	}

	// Update subscription status
	await ctx.adapter.update({
		model: "subscription",
		update: {
			status: "cancelled",
			canceledAt: subscription.cancelled_at
				? new Date(subscription.cancelled_at * 1000)
				: new Date(),
			updatedAt: new Date(),
		},
		where: [{ field: "id", value: dbSubscription.id }],
	});

	// Call subscription deleted callback
	const subscriptionOptions = options.subscription as SubscriptionOptions;
	await subscriptionOptions?.onSubscriptionDeleted?.({
		subscription: {
			...dbSubscription,
			status: "cancelled",
			canceledAt: subscription.cancelled_at
				? new Date(subscription.cancelled_at * 1000)
				: new Date(),
		},
	});

	ctx.logger.info(`Subscription ${dbSubscription.id} cancelled successfully`);
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
	const subscriptions = await ctx.adapter.findMany({
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
	// This handles cases where metadata is missing or incorrect
	try {
		// Try to find and clear user
		const users = await ctx.adapter.findMany({
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

	// Try to clear organizations (if enabled)
	if (_options.organization?.enabled) {
		try {
			const organizations = await ctx.adapter.findMany({
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
