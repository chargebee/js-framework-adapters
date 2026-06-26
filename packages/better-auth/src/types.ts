import type { Session, User } from "better-auth";
import type { Organization } from "better-auth/plugins/organization";
import type Chargebee from "chargebee";
import type {
	Subscription as ChargebeeSubscription,
	WebhookEvent as ChargebeeWebhookEvent,
	Customer,
	WebhookHandler,
} from "chargebee";

export interface ChargebeePlan {
	name: string;
	itemPriceId: string;
	itemId?: string;
	itemFamilyId?: string;
	type: "plan" | "addon" | "charge";
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
	| "create-subscription"
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
	preventDuplicateTrials?: boolean;
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

export type WebhookEvent = ChargebeeWebhookEvent;

/**
 * Event bus seam used to decouple webhook ingestion from processing.
 *
 * When provided via {@link ChargebeeOptions.webhookEventBus}, the webhook
 * endpoint validates and parses each incoming Chargebee event and then calls
 * `publish` instead of running the DB-sync hooks inline. The application is
 * expected to push the event onto its own queue and later process it from a
 * consumer using `createChargebeeWebhookProcessor`.
 */
export interface ChargebeeWebhookEventBus {
	/** Called at the HTTP endpoint for every validated, parsed event. */
	publish(event: WebhookEvent): Promise<void> | void;
}

// Use native Chargebee customer creation params
export type ChargebeeCustomerCreateParams = Partial<Customer.CreateInputParam>;

export interface ChargebeeOptions {
		chargebeeClient: InstanceType<typeof Chargebee>;
		webhookUsername?: string;
		webhookPassword?: string;
		createCustomerOnSignUp?: boolean;
		/**
		 * Return additional params to pass to `cb.customer.create` for user customers.
		 * Use this to pass fields like `first_name`, `last_name`, or any other
		 * Chargebee customer params. The `ctx` argument is only available when the
		 * customer is created on-demand (e.g. at subscription time), not during sign-up.
		 */
		getCustomerCreateParams?: (
			user: User,
			ctx?: Record<string, unknown>,
		) =>
			| Promise<Partial<ChargebeeCustomerCreateParams>>
			| Partial<ChargebeeCustomerCreateParams>;
		onCustomerCreate?: (params: CustomerCreateParams) => Promise<void> | void;
		webhookHandler?: (handler: WebhookHandler) => void;
		/**
		 * Optional event bus used to decouple webhook ingestion from processing.
		 *
		 * When set, the webhook endpoint in the app is exptected to validate and
		 * parses each event and calls `webhookEventBus.publish(event)` (typically pushing it onto an application
		 * queue) instead of running the DB-sync hooks inline. Process queued events
		 * later with `createChargebeeWebhookProcessor`.
		 *
		 * When not set, events are processed synchronously within the request.
		 */
		webhookEventBus?: ChargebeeWebhookEventBus;
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
