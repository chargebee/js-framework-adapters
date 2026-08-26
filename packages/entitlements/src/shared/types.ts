/**
 * Who an entitlement is evaluated for: a Chargebee customer, whose
 * entitlements are consolidated across their subscriptions, or a single
 * subscription. Exactly one identifier, so there is nothing to configure and
 * no mode to reconcile.
 */
export type ChargebeeTarget =
	| { customerId: string; subscriptionId?: never }
	| { subscriptionId: string; customerId?: never };

/**
 * A minimal, framework-agnostic logger. Structurally compatible with
 * `console` and with the `Logger` type OpenFeature SDKs pass to providers.
 */
export interface Logger {
	error(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	info(...args: unknown[]): void;
	debug(...args: unknown[]): void;
}

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
