import type Chargebee from "chargebee";
import type { Customer } from "chargebee";

export interface ChargebeePlan {
	name: string;
	itemPriceId: string;
	itemId: string;
	itemFamilyId: string;
	type: "plan" | "addon" | "charges";
	trialPeriod: number;
	trialPeriodUnit: "day" | "month";
	billingCycles: number;
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
	subscription?: {
		enabled: boolean;
		plans: ChargebeePlan[] | (() => Promise<ChargebeePlan[]>);
		preventDuplicateTrails?: boolean;

		// subscription lifecycle
		onSubscriptionComplete?: (params: any) => Promise<void> | void;
		onSubscriptionCreated?: (params: any) => Promise<void> | void;
		onSubscriptionUpdate?: (params: any) => Promise<void> | void;
		onSubscriptionDeleted?: (params: any) => Promise<void> | void;
		onTrialStart?: (params: any) => Promise<void> | void;
		onTrialEnd?: (params: any) => Promise<void> | void;

		// hostedPages
		getHostedPageParams?: (params: {
			user: any;
			session: any;
			plan: ChargebeePlan;
		}) => Promise<Record<string, any>>;

		// Reference authorization
		authorizeReference?: (params: {
			user: any;
			session: any;
			referenceId: string;
			action: string;
		}) => Promise<boolean>;
	};
	organization?: {
		enabled: boolean;
	};
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
