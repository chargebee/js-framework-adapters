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
	WithChargebeeCustomerId,
} from "./types";
import {
	getPlanByName,
	getReferenceId,
	getUrl,
	isActiveOrTrialing,
	isPendingCancel,
} from "./utils";

export function getWebhookEndpoint(options: ChargebeeOptions) {
	return createAuthEndpoint(
		"/chargebee/webhook",
		{
			method: "POST",
			metadata: { isAction: false },
		},
		async (ctx) => {
			if (options.webhookUsername || options.webhookPassword) {
				const authHeader = ctx.request?.headers.get("authorization");
				if (
					!verifyBasicAuth(
						authHeader,
						options.webhookUsername,
						options.webhookPassword,
					)
				) {
					throw new APIError("UNAUTHORIZED", {
						message: "Webhook verification failed",
					});
				}
			}

			const event = ctx.body as any;
			const eventType = event?.event_type;
			const content = event?.content;
			console.log(eventType);

			if (!eventType || !content) {
				throw new APIError("BAD_REQUEST", {
					message: "Invalid webhook payload",
				});
			}
			await options.onEvent?.(event);
			return ctx.json({ received: true });
		},
	);
}

function verifyBasicAuth(
	header: string | null | undefined,
	expectedUser?: string,
	expectedPass?: string,
): boolean {
	if (!header?.startsWith("Basic ")) return false;
	const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
	const [user, pass] = decoded.split(":");

	if (expectedUser && user !== expectedUser) return false;
	if (expectedPass && pass !== expectedPass) return false;
	return true;
}

export function upgradeSubscription(options: ChargebeeOptions) {
	const cb = options.chargebeeClient;
	const subscriptionOptions = options.subscription as SubscriptionOptions;

	return createAuthEndpoint(
		"/subscription/upgrade",
		{
			method: "POST",
			body: z.object({
				plan: z.string(),
				successUrl: z.string(),
				cancelUrl: z.string(),
				returnUrl: z.string().optional(),
				referenceId: z.string().optional(),
				subscriptionId: z.string().optional(),
				customerType: z.enum(["user", "organization"]).optional(),
				seats: z.number().optional(),
				metadata: z.record(z.string(), z.unknown()).optional(),
				disableRedirect: z.boolean().optional(),
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

			// Resolve plan
			const plan = await getPlanByName(options, ctx.body.plan);
			if (!plan) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.PLAN_NOT_FOUND,
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
							} as any);

							// Filter by organizationId in metadata
							let chargebeeCustomer = customerList?.list?.find(
								(item: any) =>
									item.customer.meta_data?.organizationId === org.id,
							)?.customer;

							if (!chargebeeCustomer) {
								// Get custom params
								let extraCreateParams: any = {};
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
						} catch (e: any) {
							ctx.context.logger.error(e);
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
						} as any);

						let chargebeeCustomer = customerList?.list?.find(
							(item: any) =>
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
					} catch (e: any) {
						ctx.context.logger.error(e);
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
			} as any);

			// Filter subscriptions by customer ID and status
			const activeSubscriptions =
				chargebeeSubsList?.list
					?.filter(
						(item: any) =>
							item.subscription.customer_id === customerId &&
							(item.subscription.status === "active" ||
								item.subscription.status === "in_trial"),
					)
					.map((item: any) => item.subscription) || [];

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

			// Get current item price ID
			const currentItemPriceId =
				activeSubscription?.subscription_items?.[0]?.item_price_id;

			// Find incomplete subscription for reuse
			const incompleteSubscription = subscriptions.find(
				(sub) => sub.status === "incomplete",
			);

			const itemPriceId = plan.itemPriceId;
			if (!itemPriceId) {
				throw ctx.error("BAD_REQUEST", {
					message: "Item price ID not found for the selected plan",
				});
			}

			// Check if already subscribed to same plan
			const isSamePlan = activeOrTrialingSubscription?.plan === ctx.body.plan;
			const isSameSeats =
				activeOrTrialingSubscription?.seats === (ctx.body.seats || 1);
			const isSameItemPrice = currentItemPriceId === itemPriceId;
			const isSubscriptionStillValid =
				!activeOrTrialingSubscription?.periodEnd ||
				activeOrTrialingSubscription.periodEnd > new Date();

			const isAlreadySubscribed =
				activeOrTrialingSubscription?.status === "active" &&
				isSamePlan &&
				isSameSeats &&
				isSameItemPrice &&
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

				// Use Chargebee Portal for subscription updates
				try {
					const portalSession = await cb.portalSession.create({
						customer: { id: customerId },
						redirect_url: getUrl(ctx, ctx.body.returnUrl || "/"),
					});

					return ctx.json({
						url: portalSession.portal_session.access_url,
						redirect: !ctx.body.disableRedirect,
					});
				} catch (e: any) {
					throw ctx.error("BAD_REQUEST", {
						message: e.message,
						code: e.api_error_code,
					});
				}
			}

			// Create new subscription
			let subscription: Subscription | undefined =
				activeOrTrialingSubscription || incompleteSubscription;

			// Update incomplete subscription
			if (incompleteSubscription && !activeOrTrialingSubscription) {
				const updated = await ctx.context.adapter.update<Subscription>({
					model: "subscription",
					update: {
						plan: plan.name.toLowerCase(),
						seats: ctx.body.seats || 1,
						updatedAt: new Date(),
					},
					where: [{ field: "id", value: incompleteSubscription.id }],
				});
				subscription = (updated as Subscription) || incompleteSubscription;
			}

			// Create new subscription record
			if (!subscription) {
				subscription = await ctx.context.adapter.create<Subscription>({
					model: "subscription",
					data: {
						plan: plan.name.toLowerCase(),
						chargebeeCustomerId: customerId,
						status: "incomplete",
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

			// Check trial eligibility
			const allSubscriptions = await ctx.context.adapter.findMany<Subscription>(
				{
					model: "subscription",
					where: [{ field: "referenceId", value: referenceId }],
				},
			);

			const hasEverTrialed = allSubscriptions.some((s) => {
				return !!(s.trialStart || s.trialEnd) || s.status === "trialing";
			});

			const freeTrial =
				!hasEverTrialed && plan.freeTrial
					? {
							trial_end:
								Math.floor(Date.now() / 1000) + plan.freeTrial.days * 86400,
						}
					: undefined;

			// Get custom params
			const params = ctx.request
				? await subscriptionOptions.getHostedPageParams?.(
						{ user, session, plan, subscription },
						ctx.request,
						ctx,
					)
				: undefined;

			// Create hosted page for checkout
			const hostedPageParams: any = {
				subscription_items: [
					{
						item_price_id: itemPriceId,
						quantity: ctx.body.seats || 1,
					},
				],
				customer: { id: customerId },
				subscription: {
					...freeTrial,
					meta_data: {
						userId: user.id,
						subscriptionId: subscription.id,
						referenceId,
						...ctx.body.metadata,
						...params?.subscription?.meta_data,
					},
				},
				redirect_url: getUrl(
					ctx,
					`${ctx.context.baseURL}/subscription/success?callbackURL=${encodeURIComponent(
						ctx.body.successUrl,
					)}&subscriptionId=${encodeURIComponent(subscription.id)}`,
				),
				cancel_url: getUrl(ctx, ctx.body.cancelUrl),
				...params,
			};

			try {
				const result =
					await cb.hostedPage.checkoutNewForItems(hostedPageParams);

				return ctx.json({
					url: result.hosted_page.url,
					id: result.hosted_page.id,
					redirect: !ctx.body.disableRedirect,
				});
			} catch (e: any) {
				throw ctx.error("BAD_REQUEST", {
					message: e.message,
					code: e.api_error_code,
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
										status: chargebeeSub.status as any,
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
			} as any);

			const activeSubscriptions =
				chargebeeSubsList?.list
					?.filter(
						(item: any) =>
							item.subscription.customer_id ===
								subscription.chargebeeCustomerId &&
							(item.subscription.status === "active" ||
								item.subscription.status === "in_trial"),
					)
					.map((item: any) => item.subscription) || [];

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
				(sub: any) => sub.id === subscription.chargebeeSubscriptionId,
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
			} catch (e: any) {
				// Check if subscription is already cancelled
				if (e.message?.includes("already") || e.message?.includes("cancel")) {
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
					message: e.message,
					code: e.api_error_code,
				});
			}
		},
	);
}
