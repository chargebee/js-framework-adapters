const CUSTOMER_PROTECTED = [
	"userId",
	"customerType",
	"organizationId",
] as const;
const SUBSCRIPTION_PROTECTED = [
	"referenceId",
	"subscriptionId",
	"plan",
] as const;

export const customerMetadata = {
	set(
		userMetadata: Record<string, string> | undefined,
		protectedValues: {
			userId: string;
			customerType: "user" | "organization";
			organizationId?: string;
		},
	): Record<string, string> {
		const result = { ...(userMetadata || {}) };
		result.userId = protectedValues.userId;
		result.customerType = protectedValues.customerType;
		if (protectedValues.organizationId) {
			result.organizationId = protectedValues.organizationId;
		}
		return result;
	},

	get(metadata: Record<string, string> | undefined) {
		return {
			userId: metadata?.userId,
			customerType: metadata?.customerType as
				| "user"
				| "organization"
				| undefined,
			organizationId: metadata?.organizationId,
		};
	},
};

export const subscriptionMetadata = {
	set(
		userMetadata: Record<string, string> | undefined,
		values: { referenceId: string; subscriptionId: string; plan: string },
	): Record<string, string> {
		const result = { ...(userMetadata || {}) };
		result.referenceId = values.referenceId;
		result.subscriptionId = values.subscriptionId;
		result.plan = values.plan;
		return result;
	},

	get(metadata: Record<string, string> | undefined) {
		return {
			referenceId: metadata?.referenceId,
			subscriptionId: metadata?.subscriptionId,
			plan: metadata?.plan,
		};
	},
};
