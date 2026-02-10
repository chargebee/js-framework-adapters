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

/**
 * Handle subscription events (created, activated, changed, renewed)
 * Syncs subscription data and populates subscription items
 */
async function handleSubscriptionEvent(
	ctx: any,
	content: any,
	_options: ChargebeeOptions,
) {
	const subscription = content.subscription;
	const customer = content.customer;

	if (!subscription || !customer) {
		ctx.context.logger.warn(
			"Missing subscription or customer in webhook event",
		);
		return;
	}

	// Log the metadata for debugging
	ctx.context.logger.info(
		`Processing subscription ${subscription.id} with metadata:`,
		subscription.meta_data,
	);

	// Find the subscription in our database by Chargebee subscription ID
	let dbSubscription = await ctx.context.adapter.findOne({
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
		ctx.context.logger.info(
			`Looking for subscription by ID: ${subscription.meta_data.subscriptionId}`,
		);
		dbSubscription = await ctx.context.adapter.findOne({
			model: "subscription",
			where: [
				{
					field: "id",
					value: subscription.meta_data.subscriptionId,
				},
			],
		});

		if (dbSubscription) {
			ctx.context.logger.info(
				`Found subscription by metadata ID: ${dbSubscription.id}`,
			);
		}
	}

	// If still not found, try to find by customer metadata (for hosted pages)
	if (!dbSubscription && customer.meta_data?.pendingSubscriptionId) {
		ctx.context.logger.info(
			`Looking for subscription by customer metadata: ${customer.meta_data.pendingSubscriptionId}`,
		);
		dbSubscription = await ctx.context.adapter.findOne({
			model: "subscription",
			where: [
				{
					field: "id",
					value: customer.meta_data.pendingSubscriptionId,
				},
			],
		});

		if (dbSubscription) {
			ctx.context.logger.info(
				`Found subscription via customer metadata: ${dbSubscription.id}`,
			);

			// Clear the pending subscription from customer metadata
			try {
				await _options.chargebeeClient.customer.update(customer.id, {
					meta_data: {
						pendingSubscriptionId: null,
						pendingReferenceId: null,
					},
				});
			} catch (e) {
				ctx.context.logger.warn("Failed to clear customer metadata", e);
			}
		}
	}

	// If still not found, try to find by referenceId from customer metadata
	if (!dbSubscription && customer.meta_data?.pendingReferenceId) {
		ctx.context.logger.info(
			`Looking for subscription by referenceId from customer: ${customer.meta_data.pendingReferenceId}`,
		);
		const subscriptions = await ctx.context.adapter.findMany({
			model: "subscription",
			where: [
				{
					field: "referenceId",
					value: customer.meta_data.pendingReferenceId,
				},
			],
		});

		// Find subscription that matches the customer and doesn't have a Chargebee ID yet
		dbSubscription = subscriptions.find(
			(sub: any) =>
				sub.chargebeeCustomerId === customer.id && !sub.chargebeeSubscriptionId,
		);

		if (dbSubscription) {
			ctx.context.logger.info(
				`Found subscription by referenceId from customer: ${dbSubscription.id}`,
			);
		}
	}

	// Map Chargebee status to our status type
	const status: SubscriptionStatus = subscription.status as SubscriptionStatus;

	// Prepare subscription update data
	const subscriptionData: any = {
		chargebeeSubscriptionId: subscription.id,
		chargebeeCustomerId: customer.id,
		status: status,
		periodStart: subscription.current_term_start
			? new Date(subscription.current_term_start * 1000)
			: null,
		periodEnd: subscription.current_term_end
			? new Date(subscription.current_term_end * 1000)
			: null,
		trialStart: subscription.trial_start
			? new Date(subscription.trial_start * 1000)
			: null,
		trialEnd: subscription.trial_end
			? new Date(subscription.trial_end * 1000)
			: null,
		canceledAt: subscription.cancelled_at
			? new Date(subscription.cancelled_at * 1000)
			: null,
		updatedAt: new Date(),
	};

	if (dbSubscription) {
		// Update existing subscription
		await ctx.context.adapter.update({
			model: "subscription",
			update: subscriptionData,
			where: [{ field: "id", value: dbSubscription.id }],
		});
	} else {
		// Create new subscription record if it doesn't exist
		// This handles cases where subscription was created directly in Chargebee
		const referenceId =
			subscription.meta_data?.referenceId ||
			subscription.meta_data?.userId ||
			subscription.meta_data?.organizationId;

		if (referenceId) {
			ctx.context.logger.info(
				`Creating new subscription with referenceId: ${referenceId}`,
			);
			dbSubscription = await ctx.context.adapter.create({
				model: "subscription",
				data: {
					...subscriptionData,
					referenceId,
					seats: 1,
				},
			});
		} else {
			ctx.context.logger.warn(
				`Cannot create subscription: missing referenceId in metadata. Subscription ID: ${subscription.id}, Metadata:`,
				JSON.stringify(subscription.meta_data),
			);
			return;
		}
	}

	// Sync subscription items
	if (dbSubscription && subscription.subscription_items) {
		// Delete existing subscription items
		await ctx.context.adapter.deleteMany({
			model: "subscriptionItem",
			where: [{ field: "subscriptionId", value: dbSubscription.id }],
		});

		// Create new subscription items
		for (const item of subscription.subscription_items) {
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

		ctx.context.logger.info(
			`Synced ${subscription.subscription_items.length} subscription items for subscription ${dbSubscription.id}`,
		);
	}
}

/**
 * Handle subscription cancellation events
 */
async function handleSubscriptionCancellation(
	ctx: any,
	content: any,
	options: ChargebeeOptions,
) {
	const subscription = content.subscription;

	if (!subscription) {
		ctx.context.logger.warn("Missing subscription in cancellation event");
		return;
	}

	const dbSubscription = await ctx.context.adapter.findOne({
		model: "subscription",
		where: [
			{
				field: "chargebeeSubscriptionId",
				value: subscription.id,
			},
		],
	});

	if (!dbSubscription) {
		ctx.context.logger.warn(
			`Subscription ${subscription.id} not found for cancellation`,
		);
		return;
	}

	// Update subscription status
	await ctx.context.adapter.update({
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

	ctx.context.logger.info(
		`Subscription ${dbSubscription.id} cancelled successfully`,
	);
}

/**
 * Handle customer deletion events
 */
async function handleCustomerDeletion(
	ctx: any,
	content: any,
	_options: ChargebeeOptions,
) {
	const customer = content.customer;

	if (!customer) {
		ctx.context.logger.warn("Missing customer in deletion event");
		return;
	}

	// Delete all subscriptions for this customer
	const subscriptions = await ctx.context.adapter.findMany({
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
		await ctx.context.adapter.deleteMany({
			model: "subscriptionItem",
			where: [{ field: "subscriptionId", value: subscription.id }],
		});

		// Delete subscription
		await ctx.context.adapter.deleteMany({
			model: "subscription",
			where: [{ field: "id", value: subscription.id }],
		});
	}

	// Clear chargebeeCustomerId from user or organization
	const customerType = customer.meta_data?.customerType;

	ctx.context.logger.info(
		`Clearing customer ${customer.id} from database (type: ${customerType})`,
	);

	// Try using metadata first
	if (customerType === "organization") {
		const organizationId = customer.meta_data?.organizationId;
		if (organizationId) {
			await ctx.context.adapter.update({
				model: "organization",
				update: { chargebeeCustomerId: null },
				where: [{ field: "id", value: organizationId }],
			});
			ctx.context.logger.info(
				`Cleared chargebeeCustomerId from organization ${organizationId}`,
			);
		}
	} else if (customerType === "user") {
		const userId = customer.meta_data?.userId;
		if (userId) {
			await ctx.context.adapter.update({
				model: "user",
				update: { chargebeeCustomerId: null },
				where: [{ field: "id", value: userId }],
			});
			ctx.context.logger.info(
				`Cleared chargebeeCustomerId from user ${userId}`,
			);
		}
	}

	// Fallback: Find user/org by chargebeeCustomerId directly
	// This handles cases where metadata is missing or incorrect
	try {
		// Try to find and clear user
		const users = await ctx.context.adapter.findMany({
			model: "user",
			where: [
				{
					field: "chargebeeCustomerId",
					value: customer.id,
				},
			],
		});

		for (const user of users) {
			await ctx.context.adapter.update({
				model: "user",
				update: { chargebeeCustomerId: null },
				where: [{ field: "id", value: user.id }],
			});
			ctx.context.logger.info(
				`Cleared chargebeeCustomerId from user ${user.id} (fallback)`,
			);
		}
	} catch (e) {
		ctx.context.logger.error(
			"Error clearing chargebeeCustomerId from users:",
			e,
		);
	}

	// Try to find and clear organization (only if enabled)
	if (_options.organization?.enabled) {
		try {
			const organizations = await ctx.context.adapter.findMany({
				model: "organization",
				where: [
					{
						field: "chargebeeCustomerId",
						value: customer.id,
					},
				],
			});

			for (const org of organizations) {
				await ctx.context.adapter.update({
					model: "organization",
					update: { chargebeeCustomerId: null },
					where: [{ field: "id", value: org.id }],
				});
				ctx.context.logger.info(
					`Cleared chargebeeCustomerId from organization ${org.id} (fallback)`,
				);
			}
		} catch (e) {
			ctx.context.logger.error(
				"Error clearing chargebeeCustomerId from organizations:",
				e,
			);
		}
	}

	ctx.context.logger.info(
		`Customer ${customer.id} and associated data deleted successfully`,
	);
}

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
			console.log("Chargebee webhook event:", eventType);

			if (!eventType || !content) {
				throw new APIError("BAD_REQUEST", {
					message: "Invalid webhook payload",
				});
			}

			try {
				// Handle different event types
				switch (eventType) {
					case "subscription_created":
					case "subscription_activated":
					case "subscription_changed":
					case "subscription_renewed":
					case "subscription_started":
						await handleSubscriptionEvent(ctx, content, options);
						break;

					case "subscription_cancelled":
					case "subscription_cancellation_scheduled":
						await handleSubscriptionCancellation(ctx, content, options);
						break;

					case "customer_deleted":
						await handleCustomerDeletion(ctx, content, options);
						break;

					default:
						// Log unhandled events
						ctx.context.logger.info(
							`Unhandled Chargebee webhook event: ${eventType}`,
						);
				}

				// Call user-defined event handler
				await options.onEvent?.(event);
			} catch (error) {
				ctx.context.logger.error("Error processing webhook event:", error);
				// Don't throw error to prevent webhook retries for processing issues
			}

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
			console.log(ctx.body);
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

			// Find future subscription for reuse
			const futureSubscription = subscriptions.find(
				(sub) => sub.status === "future",
			);

			// Check if already subscribed to same item prices
			const currentItemPriceIds =
				activeSubscription?.subscription_items?.map(
					(item: any) => item.item_price_id,
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
						{ user, session, plan: undefined as any, subscription },
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
				let result;

				if (hasActiveSubscription) {
					// Upgrade existing subscription using checkoutExistingForItems
					ctx.context.logger.info(
						`Upgrading existing subscription ${activeSubscription.id}`,
					);

					const existingSubParams: any = {
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

					const newSubParams: any = {
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
