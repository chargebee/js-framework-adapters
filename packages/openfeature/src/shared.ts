import { z } from "zod";

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

export type EntitlementCacheSource = "api" | "memory" | "redis" | "relay";

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

const entitlementSchema = z.object({
	featureId: z.string().min(1),
	value: z.string().optional(),
	name: z.string().optional(),
	featureName: z.string().optional(),
	featureUnit: z.string().optional(),
	featureType: z.string().optional(),
	isEnabled: z.boolean(),
	isOverridden: z.boolean().optional(),
	expiresAt: z.number().int().optional(),
});

const snapshotSchema = z.object({
	schemaVersion: z.literal(1),
	generatedAt: z.iso.datetime(),
	expiresAt: z.iso.datetime(),
	targetMode: z.enum(["customer", "subscription"]),
	entitlements: z.record(z.string(), entitlementSchema),
});

export function parseEntitlementsSnapshot(
	input: unknown,
): ChargebeeEntitlementsSnapshot {
	return snapshotSchema.parse(input);
}

export function serializeEntitlementsSnapshot(
	snapshot: ChargebeeEntitlementsSnapshot,
): string {
	return JSON.stringify(snapshot);
}

export function parseSerializedEntitlementsSnapshot(
	value: string,
): ChargebeeEntitlementsSnapshot {
	return parseEntitlementsSnapshot(JSON.parse(value));
}

export function createEntitlementsSnapshot(
	targetMode: ChargebeeEvaluationMode,
	entitlements: Iterable<ChargebeeEntitlement>,
	ttlMs: number,
	now = Date.now(),
): ChargebeeEntitlementsSnapshot {
	const entries: Record<string, ChargebeeEntitlement> = {};
	for (const entitlement of entitlements) {
		entries[entitlement.featureId] = entitlement;
	}

	return {
		schemaVersion: 1,
		generatedAt: new Date(now).toISOString(),
		expiresAt: new Date(now + ttlMs).toISOString(),
		targetMode,
		entitlements: entries,
	};
}

export function isSnapshotExpired(
	snapshot: ChargebeeEntitlementsSnapshot,
	now = Date.now(),
): boolean {
	return Date.parse(snapshot.expiresAt) <= now;
}

export function getTargetFromContext(
	context: EvaluationContextLike,
	defaultMode: ChargebeeEvaluationMode = "customer",
): ChargebeeTarget {
	const explicitMode = context[CHARGEBEE_CONTEXT_KEYS.evaluationMode];
	const mode =
		explicitMode === "customer" || explicitMode === "subscription"
			? explicitMode
			: defaultMode;

	if (mode === "customer") {
		const customerId = context[CHARGEBEE_CONTEXT_KEYS.customerId];
		if (typeof customerId !== "string" || customerId.length === 0) {
			throw new Error(
				`Evaluation context requires a non-empty ${CHARGEBEE_CONTEXT_KEYS.customerId}`,
			);
		}
		return { mode, customerId };
	}

	const subscriptionId = context[CHARGEBEE_CONTEXT_KEYS.subscriptionId];
	if (typeof subscriptionId !== "string" || subscriptionId.length === 0) {
		throw new Error(
			`Evaluation context requires a non-empty ${CHARGEBEE_CONTEXT_KEYS.subscriptionId}`,
		);
	}
	return { mode, subscriptionId };
}

function metadataFor(
	entitlement: ChargebeeEntitlement,
	source: EntitlementCacheSource,
): Record<string, boolean | string | number> {
	const metadata: Record<string, boolean | string | number> = {
		chargebeeFeatureId: entitlement.featureId,
		chargebeeEnabled: entitlement.isEnabled,
		cacheSource: source,
	};
	if (entitlement.value !== undefined) {
		metadata.chargebeeValue = entitlement.value;
	}
	if (entitlement.featureType !== undefined) {
		metadata.chargebeeFeatureType = entitlement.featureType;
	}
	if (entitlement.featureUnit !== undefined) {
		metadata.chargebeeFeatureUnit = entitlement.featureUnit;
	}
	if (entitlement.isOverridden !== undefined) {
		metadata.chargebeeOverridden = entitlement.isOverridden;
	}
	if (entitlement.expiresAt !== undefined) {
		metadata.chargebeeExpiresAt = entitlement.expiresAt;
	}
	return metadata;
}

function errorResolution<T>(
	defaultValue: T,
	errorCode: EntitlementErrorCode,
	errorMessage: string,
): EntitlementResolution<T> {
	return {
		value: defaultValue,
		reason: "ERROR",
		errorCode,
		errorMessage,
	};
}

function findEnabledEntitlement<T>(
	snapshot: ChargebeeEntitlementsSnapshot,
	flagKey: string,
	defaultValue: T,
	source: EntitlementCacheSource,
	now = Date.now(),
):
	| {
			entitlement: ChargebeeEntitlement;
			metadata: Record<string, boolean | string | number>;
	  }
	| EntitlementResolution<T> {
	const entitlement = snapshot.entitlements[flagKey];
	if (!entitlement) {
		return errorResolution(
			defaultValue,
			"FLAG_NOT_FOUND",
			`Chargebee feature ${flagKey} was not found`,
		);
	}

	const metadata = metadataFor(entitlement, source);
	const isExpired =
		entitlement.expiresAt !== undefined && entitlement.expiresAt * 1000 <= now;
	if (!entitlement.isEnabled || isExpired) {
		return {
			value: defaultValue,
			variant: "disabled",
			reason: "DISABLED",
			flagMetadata: metadata,
		};
	}

	return { entitlement, metadata };
}

function successReason(source: EntitlementCacheSource): string {
	return source === "api" ? "TARGETING_MATCH" : "CACHED";
}

export function resolveBooleanEntitlement(
	snapshot: ChargebeeEntitlementsSnapshot,
	flagKey: string,
	defaultValue: boolean,
	source: EntitlementCacheSource,
): EntitlementResolution<boolean> {
	const found = findEnabledEntitlement(snapshot, flagKey, defaultValue, source);
	if (!("entitlement" in found)) return found;

	const normalized = found.entitlement.value?.trim().toLowerCase();
	if (
		(normalized === undefined || normalized === "") &&
		(found.entitlement.featureType === undefined ||
			found.entitlement.featureType === "switch")
	) {
		return {
			value: true,
			variant: "enabled",
			reason: successReason(source),
			flagMetadata: found.metadata,
		};
	}
	if (
		normalized !== "true" &&
		normalized !== "false" &&
		normalized !== "available"
	) {
		return errorResolution(
			defaultValue,
			"TYPE_MISMATCH",
			`Chargebee feature ${flagKey} is not a boolean entitlement`,
		);
	}

	const value = normalized === "true" || normalized === "available";
	return {
		value,
		variant: value ? "enabled" : "disabled",
		reason: successReason(source),
		flagMetadata: found.metadata,
	};
}

export function resolveStringEntitlement(
	snapshot: ChargebeeEntitlementsSnapshot,
	flagKey: string,
	defaultValue: string,
	source: EntitlementCacheSource,
): EntitlementResolution<string> {
	const found = findEnabledEntitlement(snapshot, flagKey, defaultValue, source);
	if (!("entitlement" in found)) return found;

	if (found.entitlement.value === undefined) {
		return errorResolution(
			defaultValue,
			"PARSE_ERROR",
			`Chargebee feature ${flagKey} has no value`,
		);
	}

	return {
		value: found.entitlement.value,
		variant: found.entitlement.value,
		reason: successReason(source),
		flagMetadata: found.metadata,
	};
}

export function resolveNumberEntitlement(
	snapshot: ChargebeeEntitlementsSnapshot,
	flagKey: string,
	defaultValue: number,
	source: EntitlementCacheSource,
): EntitlementResolution<number> {
	const found = findEnabledEntitlement(snapshot, flagKey, defaultValue, source);
	if (!("entitlement" in found)) return found;

	const rawValue = found.entitlement.value?.trim();
	if (rawValue?.toLowerCase() === "unlimited") {
		return {
			value: Number.POSITIVE_INFINITY,
			variant: "unlimited",
			reason: successReason(source),
			flagMetadata: { ...found.metadata, unlimited: true },
		};
	}

	const value =
		rawValue === undefined || rawValue === "" ? Number.NaN : Number(rawValue);
	if (!Number.isFinite(value)) {
		return errorResolution(
			defaultValue,
			"TYPE_MISMATCH",
			`Chargebee feature ${flagKey} is not a numeric entitlement`,
		);
	}

	return {
		value,
		variant: rawValue,
		reason: successReason(source),
		flagMetadata: found.metadata,
	};
}

export function resolveObjectEntitlement<T>(
	snapshot: ChargebeeEntitlementsSnapshot,
	flagKey: string,
	defaultValue: T,
	source: EntitlementCacheSource,
): EntitlementResolution<T> {
	const found = findEnabledEntitlement(snapshot, flagKey, defaultValue, source);
	if (!("entitlement" in found)) return found;

	return {
		value: found.entitlement as unknown as T,
		variant: found.entitlement.value ?? "enabled",
		reason: successReason(source),
		flagMetadata: found.metadata,
	};
}
