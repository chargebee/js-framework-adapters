import type { GenericEndpointContext } from "@better-auth/core";
import type { User } from "@better-auth/core/db";
import type { Organization } from "better-auth/plugins/organization";
import type {
	Subscription as ChargebeeSubscription,
	Customer,
} from "chargebee";
import type {
	ChargebeeOptions,
	CustomerType,
	Subscription,
	SubscriptionOptions,
} from "./types";
import { getPlanByItemPriceId } from "./utils";

/**
 * Find organization or user by chargebeeCustomerId.
 * @internal
 */
async function findReferenceByChargebeeCustomerId(
	ctx: GenericEndpointContext,
	options: ChargebeeOptions,
	chargebeeCustomerId: string,
): Promise<{ customerType: CustomerType; referenceId: string } | null> {
	if (options.organization?.enabled) {
		const org = await ctx.context.adapter.findOne<Organization>({
			model: "organization",
			where: [{ field: "chargebeeCustomerId", value: chargebeeCustomerId }],
		});
		if (org) return { customerType: "organization", referenceId: org.id };
	}

	const user = await ctx.context.adapter.findOne<User>({
		model: "user",
		where: [{ field: "chargebeeCustomerId", value: chargebeeCustomerId }],
	});
	if (user) return { customerType: "user", referenceId: user.id };

	return null;
}

/**
 * Hook called when a subscription is activated or first created
 */
export async function onSubscriptionCreated(
	ctx: GenericEndpointContext,
	options: ChargebeeOptions,
	subscription: ChargebeeSubscription,
	customer: Customer,
) {
	try {
		if (!options.subscription?.enabled) {
			return;
		}

		const chargebeeCustomerId = customer.id;
		if (!chargebeeCustomerId) {
			ctx.context.logger.warn(
				`Chargebee webhook warning: subscription event received without customer ID`,
			);
			return;
		}

		// Check if subscription already exists in database
		const existingSubscription =
			await ctx.context.adapter.findOne<Subscription>({
				model: "subscription",
				where: [{ field: "chargebeeSubscriptionId", value: subscription.id }],
			});

		if (existingSubscription) {
			ctx.context.logger.info(
				`Chargebee webhook: Subscription already exists in database (id: ${existingSubscription.id}), skipping creation`,
			);
			return;
		}

		// Find reference (user or organization)
		const reference = await findReferenceByChargebeeCustomerId(
			ctx,
			options,
			chargebeeCustomerId,
		);
		if (!reference) {
			ctx.context.logger.warn(
				`Chargebee webhook warning: No user or organization found with chargebeeCustomerId: ${chargebeeCustomerId}`,
			);
			return;
		}
		const { referenceId, customerType } = reference;

		const subscriptionItems = subscription.subscription_items || [];
		if (!subscriptionItems.length) {
			ctx.context.logger.warn(
				`Chargebee webhook warning: Subscription ${subscription.id} has no items`,
			);
			return;
		}

		// Get the first item to determine the plan
		const primaryItem = subscriptionItems[0];
		if (!primaryItem) {
			ctx.context.logger.warn(
				`Chargebee webhook warning: Subscription ${subscription.id} has no valid items`,
			);
			return;
		}
		const itemPriceId = primaryItem.item_price_id;

		const subscriptionOptions = options.subscription as SubscriptionOptions;
		const plan = await getPlanByItemPriceId(options, itemPriceId);

		if (!plan) {
			ctx.context.logger.warn(
				`Chargebee webhook warning: No matching plan found for itemPriceId: ${itemPriceId}`,
			);
			return;
		}

		const seats = primaryItem.quantity || 1;
		const periodStart = subscription.current_term_start
			? new Date(subscription.current_term_start * 1000)
			: new Date();
		const periodEnd = subscription.current_term_end
			? new Date(subscription.current_term_end * 1000)
			: undefined;

		const trial =
			subscription.trial_start && subscription.trial_end
				? {
						trialStart: new Date(subscription.trial_start * 1000),
						trialEnd: new Date(subscription.trial_end * 1000),
					}
				: {};

		// Create the subscription in the database
		const newSubscription = await ctx.context.adapter.create<Subscription>({
			model: "subscription",
			data: {
				referenceId,
				chargebeeCustomerId,
				chargebeeSubscriptionId: subscription.id,
				status: subscription.status,
				periodStart,
				periodEnd,
				seats,
				...trial,
			},
		});

		// Create subscription items
		for (const item of subscriptionItems) {
			await ctx.context.adapter.create({
				model: "subscriptionItem",
				data: {
					subscriptionId: newSubscription.id,
					itemPriceId: item.item_price_id,
					itemType: item.item_type || "plan",
					quantity: item.quantity || 1,
					unitPrice: item.unit_price || null,
					amount: item.amount || null,
				},
			});
		}

		ctx.context.logger.info(
			`Chargebee webhook: Created subscription ${subscription.id} for ${customerType} ${referenceId}`,
		);

		// Call user-defined callback
		await subscriptionOptions.onSubscriptionCreated?.({
			subscription: newSubscription,
			chargebeeSubscription: subscription,
			plan,
		});

		// Call trial start hook if applicable
		if (trial.trialStart) {
			await subscriptionOptions.onTrialStart?.({
				subscription: newSubscription,
				chargebeeSubscription: subscription,
			});
		}
	} catch (error: unknown) {
		ctx.context.logger.error(`Chargebee webhook failed. Error: ${error}`);
	}
}

/**
 * Hook called when a subscription is updated or changed
 */
export async function onSubscriptionUpdated(
	ctx: GenericEndpointContext,
	options: ChargebeeOptions,
	subscription: ChargebeeSubscription,
	customer: Customer,
) {
	try {
		if (!options.subscription?.enabled) {
			return;
		}

		const subscriptionItems = subscription.subscription_items || [];
		if (!subscriptionItems.length) {
			ctx.context.logger.warn(
				`Chargebee webhook warning: Subscription ${subscription.id} has no items`,
			);
			return;
		}

		const customerId = customer.id;
		let dbSubscription = await ctx.context.adapter.findOne<Subscription>({
			model: "subscription",
			where: [{ field: "chargebeeSubscriptionId", value: subscription.id }],
		});

		if (!dbSubscription) {
			// Try to find by customer ID
			const subs = await ctx.context.adapter.findMany<Subscription>({
				model: "subscription",
				where: [{ field: "chargebeeCustomerId", value: customerId }],
			});
			if (subs.length > 1) {
				const activeSub = subs.find(
					(sub: Subscription) =>
						sub.status === "active" || sub.status === "in_trial",
				);
				if (!activeSub) {
					ctx.context.logger.warn(
						`Chargebee webhook error: Multiple subscriptions found for customerId: ${customerId} and no active subscription is found`,
					);
					return;
				}
				dbSubscription = activeSub;
			} else if (subs[0]) {
				dbSubscription = subs[0];
			}
		}

		if (!dbSubscription) {
			ctx.context.logger.warn(
				`Chargebee webhook warning: Subscription not found for subscriptionId: ${subscription.id}`,
			);
			return;
		}

		// Check for trial end
		const wasTrialing = dbSubscription.status === "in_trial";
		const isNowActive = subscription.status === "active";

		const primaryItem = subscriptionItems[0];
		if (!primaryItem) {
			ctx.context.logger.warn(
				`Chargebee webhook warning: Subscription ${subscription.id} has no valid items`,
			);
			return;
		}
		const periodStart = subscription.current_term_start
			? new Date(subscription.current_term_start * 1000)
			: undefined;
		const periodEnd = subscription.current_term_end
			? new Date(subscription.current_term_end * 1000)
			: undefined;

		const updatedSubscription = await ctx.context.adapter.update<Subscription>({
			model: "subscription",
			update: {
				updatedAt: new Date(),
				status: subscription.status,
				periodStart,
				periodEnd,
				canceledAt: subscription.cancelled_at
					? new Date(subscription.cancelled_at * 1000)
					: null,
				trialStart: subscription.trial_start
					? new Date(subscription.trial_start * 1000)
					: null,
				trialEnd: subscription.trial_end
					? new Date(subscription.trial_end * 1000)
					: null,
				seats: primaryItem.quantity || 1,
				chargebeeSubscriptionId: subscription.id,
			},
			where: [
				{
					field: "id",
					value: dbSubscription.id,
				},
			],
		});

		// Update subscription items
		await ctx.context.adapter.deleteMany({
			model: "subscriptionItem",
			where: [{ field: "subscriptionId", value: dbSubscription.id }],
		});

		for (const item of subscriptionItems) {
			await ctx.context.adapter.create({
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

		const subscriptionOptions = options.subscription as SubscriptionOptions;

		// Check if subscription is newly scheduled for cancellation
		const isNewCancellation =
			subscription.status === "active" &&
			subscription.cancelled_at &&
			!dbSubscription.canceledAt;

		if (isNewCancellation) {
			await subscriptionOptions.onSubscriptionCancel?.({
				subscription: updatedSubscription || dbSubscription,
				chargebeeSubscription: subscription,
			});
		}

		// Call update hook
		await subscriptionOptions.onSubscriptionUpdate?.({
			subscription: updatedSubscription || dbSubscription,
			chargebeeSubscription: subscription,
		});

		// Call trial end hook if trial ended
		if (wasTrialing && isNowActive) {
			await subscriptionOptions.onTrialEnd?.({
				subscription: updatedSubscription || dbSubscription,
				chargebeeSubscription: subscription,
			});
		}
	} catch (error: unknown) {
		ctx.context.logger.error(`Chargebee webhook failed. Error: ${error}`);
	}
}

/**
 * Hook called when a subscription is deleted or cancelled
 */
export async function onSubscriptionDeleted(
	ctx: GenericEndpointContext,
	options: ChargebeeOptions,
	subscription: ChargebeeSubscription,
) {
	if (!options.subscription?.enabled) {
		return;
	}
	try {
		const subscriptionId = subscription.id;
		const dbSubscription = await ctx.context.adapter.findOne<Subscription>({
			model: "subscription",
			where: [
				{
					field: "chargebeeSubscriptionId",
					value: subscriptionId,
				},
			],
		});

		if (dbSubscription) {
			await ctx.context.adapter.update({
				model: "subscription",
				where: [
					{
						field: "id",
						value: dbSubscription.id,
					},
				],
				update: {
					status: "cancelled",
					updatedAt: new Date(),
					canceledAt: subscription.cancelled_at
						? new Date(subscription.cancelled_at * 1000)
						: new Date(),
				},
			});

			const subscriptionOptions = options.subscription as SubscriptionOptions;
			await subscriptionOptions.onSubscriptionDeleted?.({
				chargebeeSubscription: subscription,
				subscription: {
					...dbSubscription,
					status: "cancelled",
					canceledAt: subscription.cancelled_at
						? new Date(subscription.cancelled_at * 1000)
						: new Date(),
				},
			});
		} else {
			ctx.context.logger.warn(
				`Chargebee webhook error: Subscription not found for subscriptionId: ${subscriptionId}`,
			);
		}
	} catch (error: unknown) {
		ctx.context.logger.error(`Chargebee webhook failed. Error: ${error}`);
	}
}

/**
 * Hook called when a subscription is completed (activated after checkout)
 */
export async function onSubscriptionComplete(
	ctx: GenericEndpointContext,
	options: ChargebeeOptions,
	subscription: ChargebeeSubscription,
	customer: Customer,
) {
	try {
		if (!options.subscription?.enabled) {
			return;
		}

		const subscriptionItems = subscription.subscription_items || [];
		if (!subscriptionItems.length) {
			ctx.context.logger.warn(
				`Chargebee webhook warning: Subscription ${subscription.id} has no items`,
			);
			return;
		}

		// Find the subscription in our database
		let dbSubscription = await ctx.context.adapter.findOne<Subscription>({
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
			dbSubscription = await ctx.context.adapter.findOne<Subscription>({
				model: "subscription",
				where: [
					{
						field: "id",
						value: subscription.meta_data.subscriptionId,
					},
				],
			});
		}

		// If still not found, try to find by customer metadata (for hosted pages)
		if (!dbSubscription && customer.meta_data?.pendingSubscriptionId) {
			dbSubscription = await ctx.context.adapter.findOne<Subscription>({
				model: "subscription",
				where: [
					{
						field: "id",
						value: customer.meta_data.pendingSubscriptionId,
					},
				],
			});
		}

		if (!dbSubscription) {
			ctx.context.logger.warn(
				`Chargebee webhook warning: Subscription not found for subscriptionId: ${subscription.id}`,
			);
			return;
		}

		const primaryItem = subscriptionItems[0];
		if (!primaryItem) {
			ctx.context.logger.warn(
				`Chargebee webhook warning: Subscription ${subscription.id} has no valid items`,
			);
			return;
		}
		const itemPriceId = primaryItem.item_price_id;

		const subscriptionOptions = options.subscription as SubscriptionOptions;
		const plan = await getPlanByItemPriceId(options, itemPriceId);

		const trial =
			subscription.trial_start && subscription.trial_end
				? {
						trialStart: new Date(subscription.trial_start * 1000),
						trialEnd: new Date(subscription.trial_end * 1000),
					}
				: {};

		// Update the subscription with complete data
		const updatedSubscription = await ctx.context.adapter.update<Subscription>({
			model: "subscription",
			update: {
				chargebeeSubscriptionId: subscription.id,
				chargebeeCustomerId: customer.id,
				status: subscription.status,
				updatedAt: new Date(),
				periodStart: subscription.current_term_start
					? new Date(subscription.current_term_start * 1000)
					: new Date(),
				periodEnd: subscription.current_term_end
					? new Date(subscription.current_term_end * 1000)
					: null,
				seats: primaryItem.quantity || 1,
				...trial,
			},
			where: [
				{
					field: "id",
					value: dbSubscription.id,
				},
			],
		});

		if (!updatedSubscription) {
			dbSubscription = await ctx.context.adapter.findOne<Subscription>({
				model: "subscription",
				where: [
					{
						field: "id",
						value: dbSubscription.id,
					},
				],
			});
		}

		// Call trial start hook if applicable
		if (trial.trialStart) {
			await subscriptionOptions.onTrialStart?.({
				subscription: (updatedSubscription || dbSubscription) as Subscription,
				chargebeeSubscription: subscription,
			});
		}

		// Call completion hook
		await subscriptionOptions.onSubscriptionComplete?.({
			subscription: (updatedSubscription || dbSubscription) as Subscription,
			chargebeeSubscription: subscription,
			plan,
		});

		ctx.context.logger.info(
			`Chargebee webhook: Subscription ${subscription.id} completed successfully`,
		);
	} catch (e: unknown) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		ctx.context.logger.error(
			`Chargebee webhook failed. Error: ${errorMessage}`,
		);
	}
}
