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
