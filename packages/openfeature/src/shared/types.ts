export const CHARGEBEE_CONTEXT_KEYS = {
	customerId: "chargebeeCustomerId",
	subscriptionId: "chargebeeSubscriptionId",
	evaluationMode: "chargebeeEvaluationMode",
} as const;

export type ChargebeeEvaluationMode = "customer" | "subscription";

export type ChargebeeTarget =
	| { mode: "customer"; customerId: string }
	| { mode: "subscription"; subscriptionId: string };

export type EvaluationContextLike = Record<string, unknown> & {
	targetingKey?: string;
};

export interface ChargebeeEntitlement {
	featureId: string;
	value?: string;
	name?: string;
	featureName?: string;
	featureUnit?: string;
	featureType?: string;
	isEnabled: boolean;
	isOverridden?: boolean;
	expiresAt?: number;
}

export interface ChargebeeEntitlementsSnapshot {
	schemaVersion: 1;
	generatedAt: string;
	expiresAt: string;
	targetMode: ChargebeeEvaluationMode;
	entitlements: Record<string, ChargebeeEntitlement>;
}

/**
 * Where a resolved snapshot came from: the Chargebee API, the shared cache,
 * the durable snapshot store, or the browser relay.
 */
export type SnapshotSource = "api" | "cache" | "store" | "relay";

export type EntitlementErrorCode =
	| "PROVIDER_NOT_READY"
	| "FLAG_NOT_FOUND"
	| "PARSE_ERROR"
	| "TYPE_MISMATCH"
	| "TARGETING_KEY_MISSING"
	| "INVALID_CONTEXT"
	| "PROVIDER_FATAL"
	| "GENERAL";

export interface EntitlementResolution<T> {
	value: T;
	variant?: string;
	reason?: string;
	errorCode?: EntitlementErrorCode;
	errorMessage?: string;
	flagMetadata?: Record<string, boolean | string | number>;
}
