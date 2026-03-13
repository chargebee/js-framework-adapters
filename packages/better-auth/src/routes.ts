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
	getPlanByItemPriceId,
	getPlans,
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
			const handler = createWebhookHandler(
				options,
				{
					context: ctx.context as Record<string, unknown>,
					adapter: ctx.context.adapter as unknown as {
						findOne: <T = unknown>(params: unknown) => Promise<T | null>;
						findMany: <T = unknown>(params: unknown) => Promise<T[]>;
						update: (params: unknown) => Promise<unknown>;
						deleteMany: (params: unknown) => Promise<void>;
						create: (params: unknown) => Promise<unknown>;
					},
					logger: ctx.context.logger,
				},
				ctx as any,
			);

			// Let user register custom event listeners on the handler
			options.webhookHandler?.(handler);

			// Handle the webhook request using the typed handler
			await handler.handle({
				body: ctx.body,
				headers: ctx.request?.headers
					? Object.fromEntries(ctx.request.headers.entries())
					: {},
				request: ctx.request,
				response: undefined, // We'll handle the response ourselves
			});

			return ctx.json({ received: true });
		},
	);
}

/**
 * Shared helper to find or create a Chargebee customer for a user or organization.
 * Returns the Chargebee customer ID.
 */
async function getOrCreateCustomerId(
	ctx: any,
	options: ChargebeeOptions,
	customerType: "user" | "organization",
	referenceId: string,
	metadata?: Record<string, unknown>,
	existingCustomerId?: string | null,
): Promise<string> {
	const cb = options.chargebeeClient;
	const { user } = ctx.context.session;

	if (existingCustomerId) return existingCustomerId;

	if (customerType === "organization") {
		const org = (await ctx.context.adapter.findOne({
			model: "organization",
			where: [{ field: "id", value: referenceId }],
		})) as (Organization & WithChargebeeCustomerId) | null;

		if (!org) {
			throw new APIError("BAD_REQUEST", {
				message: CHARGEBEE_ERROR_CODES.ORGANIZATION_NOT_FOUND.message,
			});
		}

		if (org.chargebeeCustomerId) return org.chargebeeCustomerId;

		try {
			let extraCreateParams: Record<string, unknown> = {};
			if (options.organization?.getCustomerCreateParams) {
				extraCreateParams = await options.organization.getCustomerCreateParams(
					org,
					ctx,
				);
			}

			const customerResult = await cb.customer.create({
				first_name: org.name,
				meta_data: {
					organizationId: org.id,
					customerType: "organization",
					...metadata,
				},
				...extraCreateParams,
			});

			const chargebeeCustomer = customerResult.customer;

			// Re-read org to guard against concurrent requests
			const freshOrg = (await ctx.context.adapter.findOne({
				model: "organization",
				where: [{ field: "id", value: org.id }],
			})) as (Organization & WithChargebeeCustomerId) | null;

			if (freshOrg?.chargebeeCustomerId) {
				try {
					await cb.customer.delete(chargebeeCustomer.id);
				} catch {
					ctx.context.logger.warn(
						`Failed to clean up duplicate Chargebee customer ${chargebeeCustomer.id}`,
					);
				}
				return freshOrg.chargebeeCustomerId;
			}

			await ctx.context.adapter.update({
				model: "organization",
				update: { chargebeeCustomerId: chargebeeCustomer.id },
				where: [{ field: "id", value: org.id }],
			});

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

			return chargebeeCustomer.id;
		} catch (e) {
			ctx.context.logger.error("Error creating customer", e);
			throw new APIError("BAD_REQUEST", {
				message: CHARGEBEE_ERROR_CODES.UNABLE_TO_CREATE_CUSTOMER.message,
			});
		}
	} else {
		// User customer
		if (user.chargebeeCustomerId) return user.chargebeeCustomerId;

		try {
			const customerList = await cb.customer.list({
				email: { is: user.email },
				limit: 1,
			});

			let chargebeeCustomer = customerList?.list?.find(
				(item) => item.customer.meta_data?.customerType !== "organization",
			)?.customer;

			if (!chargebeeCustomer) {
				const customerResult = await cb.customer.create({
					email: user.email,
					first_name: user.name?.split(" ")[0],
					last_name: user.name?.split(" ").slice(1).join(" "),
					meta_data: {
						userId: user.id,
						customerType: "user",
						...metadata,
					},
				});
				chargebeeCustomer = customerResult.customer;
			}

			// Re-read user to guard against concurrent requests
			const freshUser = (await ctx.context.adapter.findOne({
				model: "user",
				where: [{ field: "id", value: user.id }],
			})) as ({ id: string } & WithChargebeeCustomerId) | null;

			if (freshUser?.chargebeeCustomerId) {
				try {
					await cb.customer.delete(chargebeeCustomer.id);
				} catch {
					ctx.context.logger.warn(
						`Failed to clean up duplicate Chargebee customer ${chargebeeCustomer.id}`,
					);
				}
				return freshUser.chargebeeCustomerId;
			}

			await ctx.context.adapter.update({
				model: "user",
				update: { chargebeeCustomerId: chargebeeCustomer.id },
				where: [{ field: "id", value: user.id }],
			});

			return chargebeeCustomer.id;
		} catch (e) {
			ctx.context.logger.error("Error creating customer", e);
			throw new APIError("BAD_REQUEST", {
				message: CHARGEBEE_ERROR_CODES.UNABLE_TO_CREATE_CUSTOMER.message,
			});
		}
	}
}

/**
 * Create a new subscription endpoint.
 * Uses Chargebee checkoutNewForItems to initiate a brand-new subscription.
 */
export function createSubscription(options: ChargebeeOptions) {
	const cb = options.chargebeeClient;
	const subscriptionOptions = options.subscription as SubscriptionOptions;

	return createAuthEndpoint(
		"/subscription/create",
		{
			method: "POST",
			body: z.object({
				itemPriceId: z.union([z.string(), z.array(z.string())]),
				successUrl: z.string(),
				cancelUrl: z.string(),
				returnUrl: z.string().optional(),
				referenceId: z.string().optional(),
				customerType: z.enum(["user", "organization"]).optional(),
				seats: z.number().optional(),
				metadata: z.record(z.string(), z.unknown()).optional(),
				disableRedirect: z.boolean().optional(),
				trialEnd: z.number().optional(),
			}),
			metadata: {
				openapi: {
					operationId: "createSubscription",
				},
			},
			use: [
				sessionMiddleware,
				referenceMiddleware(subscriptionOptions, "create-subscription"),
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
					message: CHARGEBEE_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED.message,
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

			const primaryItemPriceId = itemPriceIds[0];
			if (!primaryItemPriceId) {
				throw new APIError("BAD_REQUEST", {
					message: "Invalid item price ID",
				});
			}

			const plan = await getPlanByItemPriceId(options, primaryItemPriceId);

			// Find or create customer
			const customerId = await getOrCreateCustomerId(
				ctx,
				options,
				customerType,
				referenceId,
				ctx.body.metadata,
			);

			// Check if user already has an active subscription
			const existingSubscriptions =
				await ctx.context.adapter.findMany<Subscription>({
					model: "subscription",
					where: [{ field: "referenceId", value: referenceId }],
				});

			const activeOrTrialingSubscription = existingSubscriptions.find((sub) =>
				isActiveOrTrialing(sub),
			);

			if (activeOrTrialingSubscription) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED.message,
				});
			}

			// Find or create DB subscription record
			const futureSubscription = existingSubscriptions.find(
				(sub) => sub.status === "future",
			);

			let subscription: Subscription | undefined = futureSubscription;

			if (futureSubscription) {
				const updated = await ctx.context.adapter.update({
					model: "subscription",
					update: {
						seats: ctx.body.seats || 1,
						updatedAt: new Date(),
					},
					where: [{ field: "id", value: futureSubscription.id }],
				});
				subscription = (updated as Subscription) || futureSubscription;
			} else {
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
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND.message,
				});
			}

			// Get custom params
			const params = ctx.request
				? await subscriptionOptions.getHostedPageParams?.(
						{ user, session, plan, subscription },
						ctx.request,
						ctx,
					)
				: undefined;

			// Store pending subscription info in customer metadata
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

			// Apply trial if configured
			let trialEnd = ctx.body.trialEnd;
			if (!trialEnd && plan?.freeTrial?.days) {
				let applyTrial = true;

				if (subscriptionOptions.preventDuplicateTrials) {
					applyTrial = !existingSubscriptions.some(
						(sub) => sub.trialStart != null,
					);

					if (!applyTrial) {
						ctx.context.logger.info(
							"User already had a trial, skipping duplicate trial",
						);
					}
				}

				if (applyTrial) {
					const trialEndDate = new Date();
					trialEndDate.setDate(trialEndDate.getDate() + plan.freeTrial.days);
					trialEnd = Math.floor(trialEndDate.getTime() / 1000);
					ctx.context.logger.info(
						`Applying ${plan.freeTrial.days}-day trial (ends: ${trialEndDate.toISOString()})`,
					);
				}
			}

			try {
				const newSubParams: Record<string, unknown> = {
					subscription_items: itemPriceIds.map((id: string) => ({
						item_price_id: id,
						quantity: ctx.body.seats || 1,
					})),
					customer: { id: customerId },
					...(trialEnd && {
						subscription: {
							trial_end: trialEnd,
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

				const result = await cb.hostedPage.checkoutNewForItems(newSubParams);

				return ctx.json({
					url: result.hosted_page.url || "",
					id: result.hosted_page.id || "",
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
 * Update (switch/upgrade) an existing subscription endpoint.
 * Uses Chargebee checkoutExistingForItems to modify an active subscription.
 */
export function updateSubscription(options: ChargebeeOptions) {
	const cb = options.chargebeeClient;
	const subscriptionOptions = options.subscription as SubscriptionOptions;

	return createAuthEndpoint(
		"/subscription/update",
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
			}),
			metadata: {
				openapi: {
					operationId: "updateSubscription",
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
					message: CHARGEBEE_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED.message,
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

			const primaryItemPriceId = itemPriceIds[0];
			if (!primaryItemPriceId) {
				throw new APIError("BAD_REQUEST", {
					message: "Invalid item price ID",
				});
			}

			const plan = await getPlanByItemPriceId(options, primaryItemPriceId);

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
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND.message,
				});
			}

			if (
				ctx.body.subscriptionId &&
				subscriptionToUpdate &&
				subscriptionToUpdate.referenceId !== referenceId
			) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND.message,
				});
			}

			// Find or create customer
			const customerId = await getOrCreateCustomerId(
				ctx,
				options,
				customerType,
				referenceId,
				ctx.body.metadata,
				subscriptionToUpdate?.chargebeeCustomerId ||
					(customerType === "user" ? user.chargebeeCustomerId : undefined),
			);

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

			// Get active Chargebee subscriptions for this customer
			const chargebeeSubsList = await cb.subscription.list({
				customer_id: { is: customerId },
				limit: 100,
			});

			const activeSubscriptions =
				chargebeeSubsList?.list
					?.filter(
						(item) =>
							item.subscription.status === "active" ||
							item.subscription.status === "in_trial" ||
							item.subscription.status === "non_renewing",
					)
					.map((item) => item.subscription) || [];

			const activeSubscription = activeSubscriptions.find((sub) => {
				if (
					subscriptionToUpdate?.chargebeeSubscriptionId ||
					ctx.body.subscriptionId
				) {
					return (
						sub.id === subscriptionToUpdate?.chargebeeSubscriptionId ||
						sub.id === ctx.body.subscriptionId
					);
				}
				if (activeOrTrialingSubscription?.chargebeeSubscriptionId) {
					return (
						sub.id === activeOrTrialingSubscription.chargebeeSubscriptionId
					);
				}
				return false;
			});

			if (!activeSubscription) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND.message,
				});
			}

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
					message: CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED.message,
				});
			}

			// Find or sync DB subscription record
			let dbSubscription = await ctx.context.adapter.findOne<Subscription>({
				model: "subscription",
				where: [
					{
						field: "chargebeeSubscriptionId",
						value: activeSubscription.id,
					},
				],
			});

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

			const subscription: Subscription =
				dbSubscription || activeOrTrialingSubscription || subscriptionToUpdate!;

			if (!subscription) {
				ctx.context.logger.error("Subscription ID not found");
				throw new APIError("NOT_FOUND", {
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND.message,
				});
			}

			// Get custom params
			const params = ctx.request
				? await subscriptionOptions.getHostedPageParams?.(
						{ user, session, plan, subscription },
						ctx.request,
						ctx,
					)
				: undefined;

			// Store pending subscription info in customer metadata
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

			try {
				const existingSubParams: Record<string, unknown> = {
					subscription: {
						id: activeSubscription.id,
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

				const result =
					await cb.hostedPage.checkoutExistingForItems(existingSubParams);

				return ctx.json({
					url: result.hosted_page.url || "",
					id: result.hosted_page.id || "",
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
 * List active subscriptions endpoint.
 * Returns the active/trialing subscriptions for the current user or organization,
 * enriched with plan limits and itemPriceId from subscription items.
 */
export function listActiveSubscriptions(options: ChargebeeOptions) {
	const subscriptionOptions = options.subscription as SubscriptionOptions;

	return createAuthEndpoint(
		"/subscription/list",
		{
			method: "GET",
			query: z
				.object({
					referenceId: z.string().optional(),
					customerType: z.enum(["user", "organization"]).optional(),
				})
				.optional(),
			metadata: {
				openapi: {
					operationId: "listActiveSubscriptions",
				},
			},
			use: [
				sessionMiddleware,
				referenceMiddleware(subscriptionOptions, "list-subscription"),
			],
		},
		async (ctx) => {
			const customerType = ctx.query?.customerType || "user";
			const referenceId =
				ctx.query?.referenceId ||
				getReferenceId(ctx.context.session, customerType, options);

			const subscriptions = await ctx.context.adapter.findMany<Subscription>({
				model: "subscription",
				where: [{ field: "referenceId", value: referenceId }],
			});

			if (!subscriptions.length) {
				return ctx.json([]);
			}

			const plans = await getPlans(options.subscription);

			const activeSubs = subscriptions.filter((sub) => isActiveOrTrialing(sub));

			const enrichedSubs = await Promise.all(
				activeSubs.map(async (sub) => {
					// Look up the subscription items to find the primary item price ID
					const items = await ctx.context.adapter.findMany<{
						id: string;
						subscriptionId: string;
						itemPriceId: string;
						itemType: string;
					}>({
						model: "subscriptionItem",
						where: [{ field: "subscriptionId", value: sub.id }],
					});

					const primaryItem =
						items.find((i) => i.itemType === "plan") || items[0];
					const plan = primaryItem
						? plans.find((p) => p.itemPriceId === primaryItem.itemPriceId)
						: undefined;

					return {
						...sub,
						limits: plan?.limits,
						itemPriceId: primaryItem?.itemPriceId,
					};
				}),
			);

			return ctx.json(enrichedSubs);
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

								await subscriptionOptions.onSubscriptionCancel?.({
									subscription: {
										...subscription,
										status: chargebeeSub.status,
										canceledAt: chargebeeSub.cancelled_at
											? new Date(chargebeeSub.cancelled_at * 1000)
											: new Date(),
									},
									chargebeeSubscription: chargebeeSub,
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
 * Portal session endpoint
 * Creates a Chargebee portal session for managing subscriptions, payment methods, invoices, etc.
 */
export function createPortalSession(options: ChargebeeOptions) {
	const cb = options.chargebeeClient;
	const subscriptionOptions = options.subscription as SubscriptionOptions;

	return createAuthEndpoint(
		"/subscription/portal",
		{
			method: "POST",
			body: z.object({
				referenceId: z.string().optional(),
				customerType: z.enum(["user", "organization"]).optional(),
				returnUrl: z.string(),
				disableRedirect: z.boolean().optional(),
			}),
			metadata: {
				openapi: {
					operationId: "createPortalSession",
				},
			},
			use: [
				sessionMiddleware,
				referenceMiddleware(subscriptionOptions, "billing-portal"),
				originCheck((ctx) => ctx.body.returnUrl),
			],
		},
		async (ctx) => {
			const { user } = ctx.context.session;
			const customerType = ctx.body.customerType || "user";
			const referenceId =
				ctx.body.referenceId ||
				getReferenceId(ctx.context.session, customerType, options);

			let customerId: string | null | undefined;

			if (customerType === "organization") {
				// Get organization's customer ID
				const subscriptions = await ctx.context.adapter.findMany<Subscription>({
					model: "subscription",
					where: [{ field: "referenceId", value: referenceId }],
				});

				const activeSubscription = subscriptions.find((sub) =>
					isActiveOrTrialing(sub),
				);

				if (!activeSubscription?.chargebeeCustomerId) {
					const org = await ctx.context.adapter.findOne<
						Organization & WithChargebeeCustomerId
					>({
						model: "organization",
						where: [{ field: "id", value: referenceId }],
					});

					if (!org) {
						throw new APIError("BAD_REQUEST", {
							message: CHARGEBEE_ERROR_CODES.ORGANIZATION_NOT_FOUND.message,
						});
					}

					customerId = org.chargebeeCustomerId;
				} else {
					customerId = activeSubscription.chargebeeCustomerId;
				}
			} else {
				// Get user's customer ID
				customerId = user.chargebeeCustomerId;
			}

			if (!customerId) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.CUSTOMER_NOT_FOUND.message,
				});
			}

			// Create portal session
			try {
				const portalSession = await cb.portalSession.create({
					customer: { id: customerId },
					redirect_url: getUrl(ctx, ctx.body.returnUrl),
				});

				return ctx.json({
					url: portalSession.portal_session.access_url,
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
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND.message,
				});
			}

			// Get active subscriptions from Chargebee for this customer
			const chargebeeSubsList = await cb.subscription.list({
				customer_id: { is: subscription.chargebeeCustomerId },
				limit: 100,
			});

			const activeSubscriptions =
				chargebeeSubsList?.list
					?.filter(
						(item) =>
							item.subscription.status === "active" ||
							item.subscription.status === "in_trial" ||
							item.subscription.status === "non_renewing",
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
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND.message,
				});
			}

			const activeSubscription = activeSubscriptions.find(
				(sub) => sub.id === subscription.chargebeeSubscriptionId,
			);

			if (!activeSubscription) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND.message,
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
