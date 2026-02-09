import type { ChargebeeOptions } from "./types";

const userSchema = {
	user: {
		fields: {
			chargebeeCustomerId: {
				type: "string" as const,
				required: false,
				unique: true,
				fieldName: "chargebeeCustomerId",
			},
		},
	},
} as const;

const orgSchema = {
	organization: {
		fields: {
			chargebeeCustomerId: {
				type: "string" as const,
				required: false,
				unique: true,
				fieldName: "chargebeeCustomerId",
			},
		},
	},
} as const;

const subscriptionSchema = {
	subscription: {
		fields: {
			referenceId: {
				type: "string" as const,
				required: true,
			},
			chargebeeCustomerId: {
				type: "string" as const,
				required: false,
			},
			chargebeeSubscriptionId: {
				type: "string" as const,
				required: false,
				unique: true,
			},
			status: {
				type: "string" as const,
				required: false,
			},
			periodStart: {
				type: "date" as const,
				required: false,
			},
			periodEnd: {
				type: "date" as const,
				required: false,
			},
			trialStart: {
				type: "date" as const,
				required: false,
			},
			trialEnd: {
				type: "date" as const,
				required: false,
			},
			canceledAt: {
				type: "date" as const,
				required: false,
			},
			metadata: {
				type: "string" as const,
				required: false,
			},
		},
	},
} as const;

const subscriptionItemSchema = {
	subscriptionItem: {
		fields: {
			subscriptionId: {
				type: "string" as const,
				required: true,
				references: {
					model: "subscription",
					field: "id",
					onDelete: "cascade",
				},
			},
			itemPriceId: {
				type: "string" as const,
				required: true,
			},
			itemType: {
				type: "string" as const,
				required: true,
			},
			quantity: {
				type: "number" as const,
				required: true,
			},
			unitPrice: {
				type: "number" as const,
				required: false,
			},
			amount: {
				type: "number" as const,
				required: false,
			},
		},
	},
} as const;

export function getSchema(options: ChargebeeOptions) {
	return {
		...userSchema,
		...subscriptionSchema,
		...subscriptionItemSchema,
		...(options.organization?.enabled ? orgSchema : {}),
	};
}
