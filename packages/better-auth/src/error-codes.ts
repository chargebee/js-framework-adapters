import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const CHARGEBEE_ERROR_CODES = defineErrorCodes({
	ALREADY_SUBSCRIBED: "You're already subscribed to this plan",
	SUBSCRIPTION_NOT_FOUND: "Subscription not found",
	PLAN_NOT_FOUND: "Plan not found",
	CUSTOMER_NOT_FOUND: "Chargebee customer not found for this user",
	ORGANIZATION_NOT_FOUND: "Organization not found",
	UNAUTHORIZED_REFERENCE: "Unauthorized access to this reference",
	ACTIVE_SUBSCRIPTION_EXISTS: "An active subscription already exists",
	ORG_HAS_ACTIVE_SUBSCRIPTIONS:
		"Cannot delete organization with active subscriptions",
	WEBHOOK_VERIFICATION_FAILED: "Webhook verification failed",
	EMAIL_VERIFICATION_REQUIRED:
		"Email verification is required before you can subscribe to a plan",
	UNABLE_TO_CREATE_CUSTOMER: "Unable to create Chargebee customer",
	ORGANIZATION_SUBSCRIPTION_NOT_ENABLED:
		"Organization subscription is not enabled",
	AUTHORIZE_REFERENCE_REQUIRED:
		"Organization subscriptions require authorizeReference callback to be configured",
	ORGANIZATION_REFERENCE_ID_REQUIRED:
		"Reference ID is required. Provide referenceId or set activeOrganizationId in session",
});
