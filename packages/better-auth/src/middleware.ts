import {
	APIError,
	sessionMiddleware as baseSessionMiddleware,
	createAuthMiddleware,
} from "better-auth/api";
import { CHARGEBEE_ERROR_CODES } from "./error-codes";
import type {
	AuthorizeReferenceAction,
	ChargebeeCtxSession,
	CustomerType,
	SubscriptionOptions,
} from "./types";

export const sessionMiddleware = createAuthMiddleware(
	{
		use: [baseSessionMiddleware],
	},
	async (ctx) => {
		const session = ctx.context.session as ChargebeeCtxSession;
		return {
			session,
		};
	},
);

export const referenceMiddleware = (
	subscriptionOptions: SubscriptionOptions,
	action: AuthorizeReferenceAction,
) =>
	createAuthMiddleware(async (ctx) => {
		const ctxSession = ctx.context.session as ChargebeeCtxSession;
		if (!ctxSession) {
			throw new APIError("UNAUTHORIZED", {
				message: CHARGEBEE_ERROR_CODES.UNAUTHORIZED_REFERENCE,
			});
		}

		const customerType: CustomerType =
			ctx.body?.customerType || ctx.query?.customerType;
		const explicitReferenceId = ctx.body?.referenceId || ctx.query?.referenceId;

		if (customerType === "organization") {
			// Organization subscriptions always require authorizeReference
			if (!subscriptionOptions.authorizeReference) {
				ctx.context.logger.error(
					`Organization subscriptions require authorizeReference to be defined in your chargebee plugin config.`,
				);
				throw new APIError("BAD_REQUEST", {
					message:
						"authorizeReference is required for organization subscriptions",
				});
			}

			const referenceId =
				explicitReferenceId || ctxSession.session.activeOrganizationId;
			if (!referenceId) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.ORGANIZATION_NOT_FOUND,
				});
			}
			const isAuthorized = await subscriptionOptions.authorizeReference(
				{
					user: ctxSession.user,
					session: ctxSession.session,
					referenceId,
					action,
				},
				ctx,
			);
			if (!isAuthorized) {
				throw new APIError("UNAUTHORIZED", {
					message: CHARGEBEE_ERROR_CODES.UNAUTHORIZED_REFERENCE,
				});
			}
			return;
		}

		// User subscriptions - pass if no explicit referenceId
		if (!explicitReferenceId) {
			return;
		}

		// Pass if referenceId is user id
		if (explicitReferenceId === ctxSession.user.id) {
			return;
		}

		if (!subscriptionOptions.authorizeReference) {
			ctx.context.logger.error(
				`Passing referenceId into a subscription action isn't allowed if subscription.authorizeReference isn't defined in your chargebee plugin config.`,
			);
			throw new APIError("BAD_REQUEST", {
				message: "referenceId not allowed without authorizeReference",
			});
		}
		const isAuthorized = await subscriptionOptions.authorizeReference(
			{
				user: ctxSession.user,
				session: ctxSession.session,
				referenceId: explicitReferenceId,
				action,
			},
			ctx,
		);
		if (!isAuthorized) {
			throw new APIError("UNAUTHORIZED", {
				message: CHARGEBEE_ERROR_CODES.UNAUTHORIZED_REFERENCE,
			});
		}
	});
