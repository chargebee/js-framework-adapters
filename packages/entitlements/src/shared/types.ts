/**
 * Who an entitlement is evaluated for: a Chargebee customer, whose
 * entitlements are consolidated across their subscriptions, or a single
 * subscription. Exactly one identifier, so there is nothing to configure and
 * no mode to reconcile.
 */
export type ChargebeeTarget =
	| { customerId: string; subscriptionId?: never }
	| { subscriptionId: string; customerId?: never };

/** A minimal, framework-agnostic logger. Structurally compatible with `console`. */
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

/**
 * Why a feature resolved to its value:
 *
 * - `granted`  — the entitlement is enabled and read as the declared type
 * - `disabled` — the entitlement is disabled or expired; default returned
 * - `pending`  — no snapshot is loaded yet; default returned
 * - `stale`    — the browser snapshot expired and is refreshing; default returned
 * - `error`    — see {@link EntitlementDetails.error}; default returned
 */
export type EntitlementStatus =
	| "granted"
	| "disabled"
	| "pending"
	| "stale"
	| "error";

/**
 * - `not-found`      — the snapshot has no entitlement for the feature
 * - `type-mismatch`  — the value cannot be read as the default value's type
 * - `invalid-target` — the target names neither or both identifiers
 * - `unavailable`    — the snapshot could not be loaded
 */
export type EntitlementErrorCode =
	| "not-found"
	| "type-mismatch"
	| "invalid-target"
	| "unavailable";

export interface EntitlementError {
	code: EntitlementErrorCode;
	message: string;
}

export interface EntitlementDetails<T> {
	value: T;
	status: EntitlementStatus;
	/** Where the snapshot came from, when one was read. */
	source?: SnapshotSource;
	/** The Chargebee entitlement behind the value, when the feature exists. */
	entitlement?: ChargebeeEntitlement;
	/** Set when `status` is `error`. */
	error?: EntitlementError;
}
