import type { Session, User } from "better-auth";
import type { Organization } from "better-auth/plugins/organization";
import type Chargebee from "chargebee";
import type {
	Event as ChargebeeEvent,
	Subscription as ChargebeeSubscription,
	Customer,
} from "chargebee";

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

// Use native Chargebee subscription status type
export type SubscriptionStatus = ChargebeeSubscription["status"];

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

// Custom logger interface - Better Auth's logger has similar structure
export interface Logger {
	info: (message: string, ...args: unknown[]) => void;
	warn: (message: string, ...args: unknown[]) => void;
	error: (message: string, ...args: unknown[]) => void;
	debug?: (message: string, ...args: unknown[]) => void;
}

export interface SubscriptionEventParams {
	subscription: Subscription;
	chargebeeSubscription?: ChargebeeSubscription;
}

export interface CustomerCreateParams {
	chargebeeCustomer: Customer;
	user: User & WithChargebeeCustomerId;
}

export interface OrganizationCustomerCreateParams {
	chargebeeCustomer: Customer;
	organization: Organization & WithChargebeeCustomerId;
}

export type SubscriptionOptions = {
	enabled: boolean;
	plans: ChargebeePlan[] | (() => Promise<ChargebeePlan[]>);
	preventDuplicateTrails?: boolean;
	requireEmailVerification?: boolean;

	// subscription lifecycle
	onSubscriptionComplete?: (params: {
		subscription: Subscription;
		chargebeeSubscription: ChargebeeSubscription;
		plan?: ChargebeePlan;
	}) => Promise<void> | void;
	onSubscriptionCreated?: (params: {
		subscription: Subscription;
		chargebeeSubscription: ChargebeeSubscription;
		plan?: ChargebeePlan;
	}) => Promise<void> | void;
	onSubscriptionUpdate?: (params: {
		subscription: Subscription;
		chargebeeSubscription?: ChargebeeSubscription;
	}) => Promise<void> | void;
	onSubscriptionCancel?: (params: {
		subscription: Subscription;
		chargebeeSubscription: ChargebeeSubscription;
	}) => Promise<void> | void;
	onSubscriptionDeleted?: (params: {
		subscription: Subscription;
		chargebeeSubscription?: ChargebeeSubscription;
	}) => Promise<void> | void;
	onTrialStart?: (params: {
		subscription: Subscription;
		chargebeeSubscription?: ChargebeeSubscription;
	}) => Promise<void> | void;
	onTrialEnd?: (params: {
		subscription: Subscription;
		chargebeeSubscription?: ChargebeeSubscription;
	}) => Promise<void> | void;

	// hostedPages
	getHostedPageParams?: (
		params: {
			user: User & WithChargebeeCustomerId;
			session: Session & WithActiveOrganizationId;
			plan: ChargebeePlan | undefined;
			subscription: Subscription;
		},
		request: Request,
		ctx: Record<string, unknown>,
	) => Promise<Record<string, unknown>>;

	// Reference authorization
	authorizeReference?: (
		params: {
			user: User & WithChargebeeCustomerId;
			session: Session & WithActiveOrganizationId;
			referenceId: string;
			action: AuthorizeReferenceAction;
		},
		ctx: Record<string, unknown>,
	) => Promise<boolean>;
};

export type WebhookEvent = ChargebeeEvent;

// Use native Chargebee customer creation params
export type ChargebeeCustomerCreateParams = Partial<Customer.CreateInputParam>;

export interface ChargebeeOptions {
	chargebeeClient: InstanceType<typeof Chargebee>;
	webhookUsername?: string;
	webhookPassword?: string;
	createCustomerOnSignUp?: boolean;
	onCustomerCreate?: (params: CustomerCreateParams) => Promise<void> | void;
	onEvent?: (event: WebhookEvent) => Promise<void> | void;
	subscription?: SubscriptionOptions;
	organization?: {
		enabled: boolean;
		getCustomerCreateParams?: (
			organization: Organization & WithChargebeeCustomerId,
			ctx: Record<string, unknown>,
		) => Promise<Partial<ChargebeeCustomerCreateParams>>;
		onCustomerCreate?: (
			params: OrganizationCustomerCreateParams,
			ctx: Record<string, unknown>,
		) => Promise<void> | void;
	};
}

export interface Subscription {
	id: string;
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
