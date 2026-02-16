import type { BetterAuthPlugin, User } from "better-auth";
import type { Customer } from "chargebee";
import { CHARGEBEE_ERROR_CODES } from "./error-codes";
import { customerMetadata } from "./metadata";
import {
	cancelSubscription,
	cancelSubscriptionCallback,
	getWebhookEndpoint,
	upgradeSubscription,
} from "./routes";
import { getSchema } from "./schema";
import type { ChargebeeOptions, WithChargebeeCustomerId } from "./types";

declare module "@better-auth/core" {
	interface BetterAuthPluginRegistry {
		chargebee: {
			creator: typeof chargebee;
		};
	}
}

export const chargebee = <O extends ChargebeeOptions>(options: O) => {
	const cb = options.chargebeeClient;

	return {
		id: "chargebee",
		schema: getSchema(options),
		endpoints: {
			chargebeeWebhook: getWebhookEndpoint(options),
			upgradeSubscription: upgradeSubscription(options),
			cancelSubscription: cancelSubscription(options),
			cancelSubscriptionCallback: cancelSubscriptionCallback(options),
		},
		options: options as NoInfer<O>,
		$ERROR_CODES: CHARGEBEE_ERROR_CODES,

		init(ctx) {
			return {
				options: {
					databaseHooks: {
						user: {
							create: {
								async after(user) {
									if (!options.createCustomerOnSignUp) return;
									const existing = await cb.customer.list({
										email: { is: user.email },
										limit: 1,
									});

									let chargebeeCustomer: Customer;

									if (
										existing.list &&
										existing.list.length > 0 &&
										existing.list[0]
									) {
										chargebeeCustomer = existing.list[0].customer;
									} else {
										const result = await cb.customer.create({
											email: user.email,
											first_name: user.name?.split(" ")[0],
											last_name: user.name?.split(" ").slice(1).join(" "),
											meta_data: customerMetadata.set(undefined, {
												userId: user.id,
												customerType: "user",
											}),
										});
										chargebeeCustomer = result.customer;
									}

									await ctx.internalAdapter.updateUser(user.id, {
										chargebeeCustomerId: chargebeeCustomer.id,
									});

									await options.onCustomerCreate?.({
										chargebeeCustomer,
										user,
									});
								},
							},
							update: {
								async after(user: User & WithChargebeeCustomerId) {
									if (!user.chargebeeCustomerId) return;
									try {
										await cb.customer.update(user.chargebeeCustomerId, {
											email: user.email,
										});
									} catch {
										// Silently fail — don't break auth for billing sync issues
									}
								},
							},
						},
						delete: {
							async before(user: User & WithChargebeeCustomerId) {
								// Clean up user's subscriptions before deleting user
								try {
									// Find all subscriptions for this user
									const subscriptions = await ctx.adapter.findMany<{
										id: string;
										chargebeeSubscriptionId: string | null;
									}>({
										model: "subscription",
										where: [
											{
												field: "referenceId",
												value: user.id,
											},
										],
									});

									// Cancel and delete each subscription
									for (const subscription of subscriptions) {
										// Cancel in Chargebee first (if subscription exists there)
										if (subscription.chargebeeSubscriptionId) {
											try {
												await cb.subscription.cancel(
													subscription.chargebeeSubscriptionId,
													{
														end_of_term: false, // Cancel immediately
													},
												);
												console.log(
													`Cancelled Chargebee subscription ${subscription.chargebeeSubscriptionId}`,
												);
											} catch (e) {
												// Log but continue - subscription might already be cancelled
												const errorMessage =
													e instanceof Error ? e.message : String(e);
												console.warn(
													`Failed to cancel subscription in Chargebee: ${errorMessage}`,
												);
											}
										}

										// Delete subscription items
										await ctx.adapter.deleteMany({
											model: "subscriptionItem",
											where: [
												{
													field: "subscriptionId",
													value: subscription.id,
												},
											],
										});

										// Delete subscription
										await ctx.adapter.deleteMany({
											model: "subscription",
											where: [
												{
													field: "id",
													value: subscription.id,
												},
											],
										});
									}

									console.log(
										`Cleaned up ${subscriptions.length} subscription(s) for user ${user.id}`,
									);
								} catch (e) {
									console.error(
										`Error cleaning up subscriptions for user ${user.id}:`,
										e,
									);
									// Don't throw - allow user deletion to proceed
								}
							},
						},
					},
				},
			};
		},
	} satisfies BetterAuthPlugin;
};

export type ChargebeePlugin<O extends ChargebeeOptions> = ReturnType<
	typeof chargebee<O>
>;

export { CHARGEBEE_ERROR_CODES } from "./error-codes";
export type {
	ChargebeeOptions,
	ChargebeePlan,
	Subscription,
	SubscriptionOptions,
	SubscriptionStatus,
	WithChargebeeCustomerId,
} from "./types";
