import type { Session, User } from "better-auth";
import type Chargebee from "chargebee";
import type { Customer } from "chargebee";

export interface ChargebeePlan {
	name: string;
	itemPriceId: string;
	itemId?: string;
	itemFamilyId?: string;
	type: "plan" | "addon" | "charges";
	trialPeriod?: number;
	trialPeriodUnit?: "day" | "month";
	billingCycles?: number;
	/**
	 * Free trial configuration
	 */
	freeTrial?: {
		days: number;
	};
	/**
	 * Plan limits/metadata
	 */
	limits?: Record<string, unknown>;
}

export type SubscriptionItemType = "plan" | "addon" | "charge";

export type SubscriptionStatus =
	| "future"
	| "in_trial"
	| "active"
	| "non_renewing"
	| "paused"
	| "cancelled"
	| "transferred"
	| "incomplete"
	| "trialing";

export type CustomerType = "user" | "organization";

export type AuthorizeReferenceAction =
	| "upgrade-subscription"
	| "list-subscription"
	| "cancel-subscription"
	| "restore-subscription"
	| "billing-portal";

export type WithActiveOrganizationId = {
	activeOrganizationId?: string;
};

export type ChargebeeCtxSession = {
	session: Session & WithActiveOrganizationId;
	user: User & WithChargebeeCustomerId;
};

export type SubscriptionOptions = {
	enabled: boolean;
	plans: ChargebeePlan[] | (() => Promise<ChargebeePlan[]>);
	preventDuplicateTrails?: boolean;
	requireEmailVerification?: boolean;

	// subscription lifecycle
	onSubscriptionComplete?: (params: any) => Promise<void> | void;
	onSubscriptionCreated?: (params: any) => Promise<void> | void;
	onSubscriptionUpdate?: (params: any) => Promise<void> | void;
	onSubscriptionDeleted?: (params: any) => Promise<void> | void;
	onTrialStart?: (params: any) => Promise<void> | void;
	onTrialEnd?: (params: any) => Promise<void> | void;

	// hostedPages
	getHostedPageParams?: (
		params: {
			user: any;
			session: any;
			plan: ChargebeePlan;
			subscription: Subscription;
		},
		request: Request,
		ctx: any,
	) => Promise<Record<string, any>>;

	// Reference authorization
	authorizeReference?: (
		params: {
			user: any;
			session: any;
			referenceId: string;
			action: AuthorizeReferenceAction;
		},
		ctx: any,
	) => Promise<boolean>;
};

export interface ChargebeeOptions {
	chargebeeClient: InstanceType<typeof Chargebee>;
	webhookUsername?: string;
	webhookPassword?: string;
	createCustomerOnSignUp?: boolean;
	onCustomerCreate?: (params: {
		chargebeeCustomer: Customer;
		user: any;
	}) => Promise<void> | void;
	onEvent?: (event: any) => Promise<void> | void;
	subscription?: SubscriptionOptions;
	organization?: {
		enabled: boolean;
		getCustomerCreateParams?: (
			organization: any,
			ctx: any,
		) => Promise<Partial<any>>;
		onCustomerCreate?: (
			params: {
				chargebeeCustomer: Customer;
				organization: any;
			},
			ctx: any,
		) => Promise<void> | void;
	};
}

export interface Subscription {
	id: string;
	plan: string;
	referenceId: string;
	chargebeeCustomerId?: string | null;
	chargebeeSubscriptionId?: string | null;
	status: SubscriptionStatus;
	periodStart?: Date | null;
	periodEnd?: Date | null;
	trialStart?: Date | null;
	trialEnd?: Date | null;
	canceledAt?: Date | null;
	seats?: number;
	metadata?: string | null;
	updatedAt?: Date;
	createdAt?: Date;
}

export interface SubscriptionRecord {
	id: string;
	referenceId: string;
	chargebeeCustomerId: string | null;
	chargebeeSubscriptionId: string | null;
	status: SubscriptionStatus | null;
	periodStart: Date | null;
	periodEnd: Date | null;
	trialStart: Date | null;
	trialEnd: Date | null;
	canceledAt: Date | null;
	metadata: string | null;
}

export interface SubscriptionItemRecord {
	id: string;
	subscriptionId: string;
	itemPriceId: string;
	itemType: SubscriptionItemType;
	quantity: number;
	unitPrice: number | null;
	amount: number | null;
}

export type WithChargebeeCustomerId = {
	chargebeeCustomerId?: string;
};
