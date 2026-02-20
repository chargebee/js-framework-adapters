import type { Session, User } from "better-auth";
import type Chargebee from "chargebee";
import type {
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

export type SubscriptionStatus =
	| "future"
	| "in_trial"
	| "active"
	| "non_renewing"
	| "paused"
	| "cancelled"
	| "transferred";

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

export interface Logger {
	info: (message: string, ...args: unknown[]) => void;
	warn: (message: string, ...args: unknown[]) => void;
	error: (message: string, ...args: unknown[]) => void;
	debug?: (message: string, ...args: unknown[]) => void;
}

// Minimal adapter interface - only what we need for our webhook handlers
export interface MinimalAdapter {
	findOne: <T = unknown>(params: unknown) => Promise<T | null>;
	findMany: <T = unknown>(params: unknown) => Promise<T[]>;
	create: <T = unknown>(params: unknown) => Promise<T>;
	update: <T = unknown>(params: unknown) => Promise<T | null>;
	deleteMany: (params: unknown) => Promise<void>;
}

// Minimal context interface - only what we need for our webhook handlers
export interface MinimalContext {
	baseURL?: string;
	adapter?: MinimalAdapter;
	logger?: Logger;
	[key: string]: unknown;
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

export interface Organization {
	id: string;
	name: string;
	slug?: string;
	logo?: string | null;
	metadata?: string | null;
	createdAt: Date;
}

// Simplified endpoint context interface that's compatible with better-auth's actual endpoint context
export interface BetterAuthEndpointContext {
	context: MinimalContext;
	body?: Record<string, unknown>;
	query?: Record<string, unknown>;
	request?: Request;
	session?: ChargebeeCtxSession;
	[key: string]: unknown;
}

export type SubscriptionOptions = {
	enabled: boolean;
	plans: ChargebeePlan[] | (() => Promise<ChargebeePlan[]>);
	preventDuplicateTrails?: boolean;
	requireEmailVerification?: boolean;

	// subscription lifecycle
	onSubscriptionComplete?: (
		params: SubscriptionEventParams,
	) => Promise<void> | void;
	onSubscriptionCreated?: (
		params: SubscriptionEventParams,
	) => Promise<void> | void;
	onSubscriptionUpdate?: (
		params: SubscriptionEventParams,
	) => Promise<void> | void;
	onSubscriptionDeleted?: (
		params: SubscriptionEventParams,
	) => Promise<void> | void;
	onTrialStart?: (params: SubscriptionEventParams) => Promise<void> | void;
	onTrialEnd?: (params: SubscriptionEventParams) => Promise<void> | void;

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

export interface WebhookEvent {
	event_type: string;
	content: Record<string, unknown>;
	[key: string]: unknown;
}

export interface ChargebeeCustomerCreateParams {
	email?: string;
	first_name?: string;
	last_name?: string;
	company?: string;
	phone?: string;
	billing_address?: Record<string, unknown>;
	meta_data?: Record<string, unknown>;
	[key: string]: unknown;
}

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
