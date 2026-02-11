import type { GenericEndpointContext } from "better-auth";
import { APIError } from "better-auth/api";
import { CHARGEBEE_ERROR_CODES } from "./error-codes";
import type {
	ChargebeeCtxSession,
	ChargebeeOptions,
	ChargebeePlan,
	CustomerType,
	Subscription,
	SubscriptionOptions,
} from "./types";

/**
 * Get all plans from the subscription options
 */
export async function getPlans(
	subscription: SubscriptionOptions | undefined,
): Promise<ChargebeePlan[]> {
	if (!subscription?.plans) {
		return [];
	}

	if (typeof subscription.plans === "function") {
		return await subscription.plans();
	}

	return subscription.plans;
}

/**
 * Get a plan by name (case-insensitive)
 */
export async function getPlanByName(
	options: ChargebeeOptions,
	planName: string,
): Promise<ChargebeePlan | undefined> {
	const plans = await getPlans(options.subscription);
	return plans.find((p) => p.name.toLowerCase() === planName.toLowerCase());
}

/**
 * Get a plan by item price ID
 */
export async function getPlanByItemPriceId(
	options: ChargebeeOptions,
	itemPriceId: string,
): Promise<ChargebeePlan | undefined> {
	const plans = await getPlans(options.subscription);
	return plans.find((p) => p.itemPriceId === itemPriceId);
}

/**
 * Check if a subscription is active or trialing
 */
export function isActiveOrTrialing(subscription: Subscription): boolean {
	return subscription.status === "active" || subscription.status === "in_trial";
}

/**
 * Check if a subscription is pending cancellation
 */
export function isPendingCancel(subscription: Subscription): boolean {
	return !!(
		subscription.canceledAt &&
		subscription.periodEnd &&
		subscription.periodEnd > new Date()
	);
}

/**
 * Determines the reference ID based on customer type.
 * - `user` (default): uses userId
 * - `organization`: uses activeOrganizationId from session
 */
export function getReferenceId(
	ctxSession: ChargebeeCtxSession,
	customerType: CustomerType | undefined,
	options: ChargebeeOptions,
): string {
	const { user, session } = ctxSession;
	const type = customerType || "user";

	if (type === "organization") {
		if (!options.organization?.enabled) {
			throw new APIError("BAD_REQUEST", {
				message: CHARGEBEE_ERROR_CODES.ORGANIZATION_SUBSCRIPTION_NOT_ENABLED,
			});
		}

		if (!session.activeOrganizationId) {
			throw new APIError("BAD_REQUEST", {
				message: CHARGEBEE_ERROR_CODES.ORGANIZATION_NOT_FOUND,
			});
		}
		return session.activeOrganizationId;
	}

	return user.id;
}

/**
 * Converts a relative URL to an absolute URL using baseURL.
 */
export function getUrl(ctx: GenericEndpointContext, url: string): string {
	if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(url)) {
		return url;
	}
	return `${ctx.context.baseURL}${url.startsWith("/") ? url : `/${url}`}`;
}
