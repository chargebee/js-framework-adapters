import {
	APIError,
	createAuthEndpoint,
	getSessionFromCtx,
	originCheck,
} from "better-auth/api";
import type { Organization } from "better-auth/plugins/organization";
import { z } from "zod";
import { CHARGEBEE_ERROR_CODES } from "./error-codes";
import { referenceMiddleware, sessionMiddleware } from "./middleware";
import type {
	ChargebeeOptions,
	Subscription,
	SubscriptionOptions,
	SubscriptionStatus,
	WithChargebeeCustomerId,
} from "./types";
import {
	getReferenceId,
	getUrl,
	isActiveOrTrialing,
	isPendingCancel,
} from "./utils";
import { createWebhookHandler } from "./webhook-handler";

export function getWebhookEndpoint(options: ChargebeeOptions) {
	return createAuthEndpoint(
		"/chargebee/webhook",
		{
			method: "POST",
			metadata: { isAction: false },
		},
		async (ctx) => {
			// Create webhook handler with better-auth context
			const handler = createWebhookHandler(options, {
				context: ctx.context as Record<string, unknown>,
				adapter: ctx.context.adapter as unknown as {
					findOne: <T = unknown>(params: unknown) => Promise<T | null>;
					findMany: <T = unknown>(params: unknown) => Promise<T[]>;
					update: (params: unknown) => Promise<unknown>;
					deleteMany: (params: unknown) => Promise<void>;
					create: (params: unknown) => Promise<unknown>;
				},
				logger: ctx.context.logger,
			});

			// Handle the webhook request using the typed handler
			await handler.handle({
				body: ctx.body,
				headers: ctx.request?.headers
					? Object.fromEntries(ctx.request.headers.entries())
					: {},
				request: ctx.request,
				response: undefined, // We'll handle the response ourselves
			});

			// Call user-defined event handler if provided
			if (options.onEvent) {
				try {
					await options.onEvent(
						ctx.body as {
							event_type: string;
							content: Record<string, unknown>;
							[key: string]: unknown;
						},
					);
				} catch (error) {
					ctx.context.logger.error("Error in custom onEvent handler:", error);
				}
			}

			return ctx.json({ received: true });
		},
	);
}

export function upgradeSubscription(options: ChargebeeOptions) {
	const cb = options.chargebeeClient;
	const subscriptionOptions = options.subscription as SubscriptionOptions;

	return createAuthEndpoint(
		"/subscription/upgrade",
		{
			method: "POST",
			body: z.object({
				itemPriceId: z.union([z.string(), z.array(z.string())]),
				successUrl: z.string(),
				cancelUrl: z.string(),
				returnUrl: z.string().optional(),
				referenceId: z.string().optional(),
				subscriptionId: z.string().optional(),
				customerType: z.enum(["user", "organization"]).optional(),
				seats: z.number().optional(),
				metadata: z.record(z.string(), z.unknown()).optional(),
				disableRedirect: z.boolean().optional(),
				trialEnd: z.number().optional(),
			}),
			metadata: {
				openapi: {
					operationId: "upgradeSubscription",
				},
			},
			use: [
				sessionMiddleware,
				referenceMiddleware(subscriptionOptions, "upgrade-subscription"),
				originCheck((c) => {
					return [c.body.successUrl as string, c.body.cancelUrl as string];
				}),
			],
		},
		async (ctx) => {
			const { user, session } = ctx.context.session;
			const customerType = ctx.body.customerType || "user";
			const referenceId =
				ctx.body.referenceId ||
				getReferenceId(ctx.context.session, customerType, options);

			// Email verification check
			if (!user.emailVerified && subscriptionOptions.requireEmailVerification) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED,
				});
			}

			// Normalize itemPriceId to array
			const itemPriceIds = Array.isArray(ctx.body.itemPriceId)
				? ctx.body.itemPriceId
				: [ctx.body.itemPriceId];

			if (!itemPriceIds.length) {
				throw new APIError("BAD_REQUEST", {
					message: "At least one item price ID is required",
				});
			}

			// If subscriptionId is provided, find that specific subscription
			const subscriptionToUpdate = ctx.body.subscriptionId
				? await ctx.context.adapter.findOne<Subscription>({
						model: "subscription",
						where: [
							{
								field: "chargebeeSubscriptionId",
								value: ctx.body.subscriptionId,
							},
						],
					})
				: null;

			if (ctx.body.subscriptionId && !subscriptionToUpdate) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
				});
			}

			if (
				ctx.body.subscriptionId &&
				subscriptionToUpdate &&
				subscriptionToUpdate.referenceId !== referenceId
			) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
				});
			}

			// Determine customer ID
			let customerId: string | null | undefined;

			if (customerType === "organization") {
				// Organization subscription
				customerId = subscriptionToUpdate?.chargebeeCustomerId;

				if (!customerId) {
					const org = await ctx.context.adapter.findOne<
						Organization & WithChargebeeCustomerId
					>({
						model: "organization",
						where: [{ field: "id", value: referenceId }],
					});

					if (!org) {
						throw new APIError("BAD_REQUEST", {
							message: CHARGEBEE_ERROR_CODES.ORGANIZATION_NOT_FOUND,
						});
					}

					customerId = org.chargebeeCustomerId ?? undefined;

					// Create customer if doesn't exist
					if (!customerId) {
						try {
							// Search for existing customer - using metadata filter
							const customerList = await cb.customer.list({
								limit: 1,
							});

							// Filter by organizationId in metadata
							let chargebeeCustomer = customerList?.list?.find(
								(item) => item.customer.meta_data?.organizationId === org.id,
							)?.customer;

							if (!chargebeeCustomer) {
								// Get custom params
								let extraCreateParams: Record<string, unknown> = {};
								if (options.organization?.getCustomerCreateParams) {
									extraCreateParams =
										await options.organization.getCustomerCreateParams(
											org,
											ctx,
										);
								}

								// Create customer
								const customerResult = await cb.customer.create({
									first_name: org.name,
									meta_data: {
										organizationId: org.id,
										customerType: "organization",
										...ctx.body.metadata,
									},
									...extraCreateParams,
								});

								chargebeeCustomer = customerResult.customer;

								// Call onCreate callback
								await options.organization?.onCustomerCreate?.(
									{
										chargebeeCustomer,
										organization: {
											...org,
											chargebeeCustomerId: chargebeeCustomer.id,
										},
									},
									ctx,
								);
							}

							// Update org with customer ID
							await ctx.context.adapter.update({
								model: "organization",
								update: { chargebeeCustomerId: chargebeeCustomer.id },
								where: [{ field: "id", value: org.id }],
							});

							customerId = chargebeeCustomer.id;
						} catch (e) {
							ctx.context.logger.error("Error creating customer", e);
							throw new APIError("BAD_REQUEST", {
								message: CHARGEBEE_ERROR_CODES.UNABLE_TO_CREATE_CUSTOMER,
							});
						}
					}
				}
			} else {
				// User subscription
				customerId =
					subscriptionToUpdate?.chargebeeCustomerId || user.chargebeeCustomerId;

				if (!customerId) {
					try {
						// Search for existing customer by email
						const customerList = await cb.customer.list({
							limit: 1,
						});

						let chargebeeCustomer = customerList?.list?.find(
							(item) =>
								item.customer.email === user.email &&
								item.customer.meta_data?.customerType !== "organization",
						)?.customer;

						if (!chargebeeCustomer) {
							const customerResult = await cb.customer.create({
								email: user.email,
								first_name: user.name,
								meta_data: {
									userId: user.id,
									customerType: "user",
									...ctx.body.metadata,
								},
							});
							chargebeeCustomer = customerResult.customer;
						}

						// Update user with customer ID
						await ctx.context.adapter.update({
							model: "user",
							update: { chargebeeCustomerId: chargebeeCustomer.id },
							where: [{ field: "id", value: user.id }],
						});

						customerId = chargebeeCustomer.id;
					} catch (e) {
						ctx.context.logger.error("Error creating customer", e);
						throw new APIError("BAD_REQUEST", {
							message: CHARGEBEE_ERROR_CODES.UNABLE_TO_CREATE_CUSTOMER,
						});
					}
				}
			}

			// Get subscriptions from DB
			const subscriptions = subscriptionToUpdate
				? [subscriptionToUpdate]
				: await ctx.context.adapter.findMany<Subscription>({
						model: "subscription",
						where: [{ field: "referenceId", value: referenceId }],
					});

			const activeOrTrialingSubscription = subscriptions.find((sub) =>
				isActiveOrTrialing(sub),
			);

			// Get active Chargebee subscriptions
			const chargebeeSubsList = await cb.subscription.list({
				limit: 100,
			});

			// Filter subscriptions by customer ID and status
			const activeSubscriptions =
				chargebeeSubsList?.list
					?.filter(
						(item) =>
							item.subscription.customer_id === customerId &&
							(item.subscription.status === "active" ||
								item.subscription.status === "in_trial"),
					)
					.map((item) => item.subscription) || [];

			const activeSubscription = activeSubscriptions.find((sub) => {
				// Match specific subscription if provided
				if (
					subscriptionToUpdate?.chargebeeSubscriptionId ||
					ctx.body.subscriptionId
				) {
					return (
						sub.id === subscriptionToUpdate?.chargebeeSubscriptionId ||
						sub.id === ctx.body.subscriptionId
					);
				}
				// Match by referenceId
				if (activeOrTrialingSubscription?.chargebeeSubscriptionId) {
					return (
						sub.id === activeOrTrialingSubscription.chargebeeSubscriptionId
					);
				}
				return false;
			});

			// Find future subscription for reuse
			const futureSubscription = subscriptions.find(
				(sub) => sub.status === "future",
			);

			// Check if already subscribed to same item prices
			const currentItemPriceIds =
				activeSubscription?.subscription_items?.map(
					(item) => item.item_price_id,
				) || [];

			const isSameItemPrices =
				itemPriceIds.length === currentItemPriceIds.length &&
				itemPriceIds.every((id: string) => currentItemPriceIds.includes(id));
			const isSameSeats =
				activeOrTrialingSubscription?.seats === (ctx.body.seats || 1);
			const isSubscriptionStillValid =
				!activeOrTrialingSubscription?.periodEnd ||
				activeOrTrialingSubscription.periodEnd > new Date();

			const isAlreadySubscribed =
				activeOrTrialingSubscription?.status === "active" &&
				isSameItemPrices &&
				isSameSeats &&
				isSubscriptionStillValid;

			if (isAlreadySubscribed) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED,
				});
			}

			// Handle upgrade of existing subscription
			if (activeSubscription && customerId) {
				// Find or create DB subscription record
				let dbSubscription = await ctx.context.adapter.findOne<Subscription>({
					model: "subscription",
					where: [
						{
							field: "chargebeeSubscriptionId",
							value: activeSubscription.id,
						},
					],
				});

				// Update existing DB record if needed
				if (!dbSubscription && activeOrTrialingSubscription) {
					await ctx.context.adapter.update<Subscription>({
						model: "subscription",
						update: {
							chargebeeSubscriptionId: activeSubscription.id,
							updatedAt: new Date(),
						},
						where: [{ field: "id", value: activeOrTrialingSubscription.id }],
					});
					dbSubscription = activeOrTrialingSubscription;
				}

				// Continue to hosted page checkout for upgrades
				// (removed portal session redirect to use checkoutExistingForItems)
			}

			// Create new subscription
			let subscription: Subscription | undefined =
				activeOrTrialingSubscription || futureSubscription;

			// Update future subscription
			if (futureSubscription && !activeOrTrialingSubscription) {
				const updated = await ctx.context.adapter.update({
					model: "subscription",
					update: {
						seats: ctx.body.seats || 1,
						updatedAt: new Date(),
					},
					where: [{ field: "id", value: futureSubscription.id }],
				});
				subscription = (updated as Subscription) || futureSubscription;
			}

			// Create new subscription record
			if (!subscription) {
				subscription = await ctx.context.adapter.create({
					model: "subscription",
					data: {
						chargebeeCustomerId: customerId,
						status: "future",
						referenceId,
						seats: ctx.body.seats || 1,
					},
				});
			}

			if (!subscription) {
				ctx.context.logger.error("Subscription ID not found");
				throw new APIError("NOT_FOUND", {
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
				});
			}

			// Get custom params
			const params = ctx.request
				? await subscriptionOptions.getHostedPageParams?.(
						{ user, session, plan: undefined, subscription },
						ctx.request,
						ctx,
					)
				: undefined;

			// Store pending subscription info in customer metadata
			// Hosted pages don't support subscription metadata, so we use customer metadata instead
			try {
				await cb.customer.update(customerId, {
					meta_data: {
						pendingSubscriptionId: subscription.id,
						pendingReferenceId: referenceId,
						userId: user.id,
					},
				});
			} catch (e) {
				ctx.context.logger.warn("Failed to update customer metadata", e);
			}

			// Check if upgrading existing subscription or creating new one
			const hasActiveSubscription = activeSubscription && activeSubscription.id;

			try {
				let result: { hosted_page: { url: string; id: string } };

				if (hasActiveSubscription) {
					// Upgrade existing subscription using checkoutExistingForItems
					ctx.context.logger.info(
						`Upgrading existing subscription ${activeSubscription.id}`,
					);

					const existingSubParams: Record<string, unknown> = {
						subscription: {
							id: activeSubscription.id,
							// Note: Trials cannot be set on existing subscriptions during upgrades
						},
						subscription_items: itemPriceIds.map((id: string) => ({
							item_price_id: id,
							quantity: ctx.body.seats || 1,
						})),
						redirect_url: getUrl(
							ctx,
							`${ctx.context.baseURL}/subscription/success?callbackURL=${encodeURIComponent(
								ctx.body.successUrl,
							)}&subscriptionId=${encodeURIComponent(subscription.id)}`,
						),
						cancel_url: getUrl(ctx, ctx.body.cancelUrl),
						...params,
					};

					result =
						await cb.hostedPage.checkoutExistingForItems(existingSubParams);
				} else {
					// Create new subscription using checkoutNewForItems
					ctx.context.logger.info("Creating new subscription via hosted page");

					const newSubParams: Record<string, unknown> = {
						subscription_items: itemPriceIds.map((id: string) => ({
							item_price_id: id,
							quantity: ctx.body.seats || 1,
						})),
						customer: { id: customerId },
						...(ctx.body.trialEnd && {
							subscription: {
								trial_end: ctx.body.trialEnd,
							},
						}),
						redirect_url: getUrl(
							ctx,
							`${ctx.context.baseURL}/subscription/success?callbackURL=${encodeURIComponent(
								ctx.body.successUrl,
							)}&subscriptionId=${encodeURIComponent(subscription.id)}`,
						),
						cancel_url: getUrl(ctx, ctx.body.cancelUrl),
						...params,
					};
					result = await cb.hostedPage.checkoutNewForItems(newSubParams);
				}

				return ctx.json({
					url: result.hosted_page.url,
					id: result.hosted_page.id,
					redirect: !ctx.body.disableRedirect,
				});
			} catch (e) {
				const error = e as { message?: string; api_error_code?: string };
				throw ctx.error("BAD_REQUEST", {
					message: error.message || "An error occurred",
					code: error.api_error_code,
				});
			}
		},
	);
}

/**
 * Callback endpoint after subscription cancellation
 * Checks if cancellation was successful and updates the database
 */
export function cancelSubscriptionCallback(options: ChargebeeOptions) {
	const cb = options.chargebeeClient;
	const subscriptionOptions = options.subscription as SubscriptionOptions;

	return createAuthEndpoint(
		"/subscription/cancel/callback",
		{
			method: "GET",
			query: z
				.object({
					callbackURL: z.string(),
					subscriptionId: z.string(),
				})
				.partial(),
			metadata: {
				openapi: {
					operationId: "cancelSubscriptionCallback",
				},
			},
			use: [originCheck((ctx) => ctx.query?.callbackURL)],
		},
		async (ctx) => {
			const callbackURL = ctx.query?.callbackURL || "/";
			const subscriptionId = ctx.query?.subscriptionId;

			if (!callbackURL || !subscriptionId) {
				throw ctx.redirect(getUrl(ctx, callbackURL));
			}

			const session = await getSessionFromCtx<
				WithChargebeeCustomerId & { id: string }
			>(ctx);
			if (!session) {
				throw ctx.redirect(getUrl(ctx, callbackURL));
			}

			const { user } = session;

			if (user?.chargebeeCustomerId) {
				try {
					const subscription = await ctx.context.adapter.findOne<Subscription>({
						model: "subscription",
						where: [
							{
								field: "id",
								value: subscriptionId,
							},
						],
					});

					if (
						!subscription ||
						subscription.status === "cancelled" ||
						isPendingCancel(subscription)
					) {
						throw ctx.redirect(getUrl(ctx, callbackURL));
					}

					// Fetch subscription from Chargebee to check current status
					if (subscription.chargebeeSubscriptionId) {
						try {
							const chargebeeSubResult = await cb.subscription.retrieve(
								subscription.chargebeeSubscriptionId,
							);
							const chargebeeSub = chargebeeSubResult.subscription;

							// Check if subscription was cancelled
							const isCancelled =
								chargebeeSubResult.subscription.status === "cancelled" ||
								!!chargebeeSub.cancelled_at;

							if (isCancelled && !subscription.canceledAt) {
								// Update DB with cancellation info
								await ctx.context.adapter.update({
									model: "subscription",
									update: {
										status: chargebeeSub.status,
										canceledAt: chargebeeSub.cancelled_at
											? new Date(chargebeeSub.cancelled_at * 1000)
											: new Date(),
									},
									where: [
										{
											field: "id",
											value: subscription.id,
										},
									],
								});

								// Call onSubscriptionCancel callback
								await subscriptionOptions.onSubscriptionDeleted?.({
									subscription: {
										...subscription,
										status: chargebeeSub.status as SubscriptionStatus,
										canceledAt: chargebeeSub.cancelled_at
											? new Date(chargebeeSub.cancelled_at * 1000)
											: new Date(),
									},
								});
							}
						} catch (error) {
							ctx.context.logger.error(
								"Error checking subscription status from Chargebee",
								error,
							);
						}
					}
				} catch (error) {
					ctx.context.logger.error(
						"Error in cancel subscription callback",
						error,
					);
				}
			}

			throw ctx.redirect(getUrl(ctx, callbackURL));
		},
	);
}

/**
 * Cancel subscription endpoint
 * Opens Chargebee portal to cancel subscription
 */
export function cancelSubscription(options: ChargebeeOptions) {
	const cb = options.chargebeeClient;
	const subscriptionOptions = options.subscription as SubscriptionOptions;

	return createAuthEndpoint(
		"/subscription/cancel",
		{
			method: "POST",
			body: z.object({
				referenceId: z.string().optional(),
				subscriptionId: z.string().optional(),
				customerType: z.enum(["user", "organization"]).optional(),
				returnUrl: z.string(),
				disableRedirect: z.boolean().optional(),
			}),
			metadata: {
				openapi: {
					operationId: "cancelSubscription",
				},
			},
			use: [
				sessionMiddleware,
				referenceMiddleware(subscriptionOptions, "cancel-subscription"),
				originCheck((ctx) => ctx.body.returnUrl),
			],
		},
		async (ctx) => {
			const customerType = ctx.body.customerType || "user";
			const referenceId =
				ctx.body.referenceId ||
				getReferenceId(ctx.context.session, customerType, options);

			// Find subscription to cancel
			let subscription = ctx.body.subscriptionId
				? await ctx.context.adapter.findOne<Subscription>({
						model: "subscription",
						where: [
							{
								field: "chargebeeSubscriptionId",
								value: ctx.body.subscriptionId,
							},
						],
					})
				: await ctx.context.adapter
						.findMany<Subscription>({
							model: "subscription",
							where: [{ field: "referenceId", value: referenceId }],
						})
						.then((subs) => subs.find((sub) => isActiveOrTrialing(sub)));

			// Verify subscription belongs to the reference
			if (
				ctx.body.subscriptionId &&
				subscription &&
				subscription.referenceId !== referenceId
			) {
				subscription = undefined;
			}

			if (!subscription || !subscription.chargebeeCustomerId) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
				});
			}

			// Get active subscriptions from Chargebee
			const chargebeeSubsList = await cb.subscription.list({
				limit: 100,
			});

			const activeSubscriptions =
				chargebeeSubsList?.list
					?.filter(
						(item) =>
							item.subscription.customer_id ===
								subscription.chargebeeCustomerId &&
							(item.subscription.status === "active" ||
								item.subscription.status === "in_trial"),
					)
					.map((item) => item.subscription) || [];

			if (!activeSubscriptions.length) {
				// No active subscriptions found in Chargebee, delete from DB
				await ctx.context.adapter.deleteMany({
					model: "subscription",
					where: [
						{
							field: "referenceId",
							value: referenceId,
						},
					],
				});
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
				});
			}

			const activeSubscription = activeSubscriptions.find(
				(sub) => sub.id === subscription.chargebeeSubscriptionId,
			);

			if (!activeSubscription) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
				});
			}

			// Create portal session for cancellation
			try {
				const portalSession = await cb.portalSession.create({
					customer: { id: subscription.chargebeeCustomerId },
					redirect_url: getUrl(
						ctx,
						`${ctx.context.baseURL}/subscription/cancel/callback?callbackURL=${encodeURIComponent(
							ctx.body.returnUrl || "/",
						)}&subscriptionId=${encodeURIComponent(subscription.id)}`,
					),
				});

				return ctx.json({
					url: portalSession.portal_session.access_url,
					redirect: !ctx.body.disableRedirect,
				});
			} catch (e) {
				const error = e as { message?: string; api_error_code?: string };
				// Check if subscription is already cancelled
				if (
					error.message?.includes("already") ||
					error.message?.includes("cancel")
				) {
					// Sync state from Chargebee
					if (!isPendingCancel(subscription)) {
						try {
							const chargebeeSubResult = await cb.subscription.retrieve(
								activeSubscription.id,
							);
							const chargebeeSub = chargebeeSubResult.subscription;

							await ctx.context.adapter.update({
								model: "subscription",
								update: {
									canceledAt: chargebeeSub.cancelled_at
										? new Date(chargebeeSub.cancelled_at * 1000)
										: new Date(),
								},
								where: [
									{
										field: "id",
										value: subscription.id,
									},
								],
							});
						} catch (retrieveError) {
							ctx.context.logger.error(
								"Error retrieving subscription from Chargebee",
								retrieveError,
							);
						}
					}
				}

				throw ctx.error("BAD_REQUEST", {
					message: error.message || "An error occurred",
					code: error.api_error_code,
				});
			}
		},
	);
}
