import type {
	EntitlementDetails,
	EntitlementErrorCode,
} from "@chargebee/entitlements";

/**
 * How a `pending` status (no snapshot loaded yet) surfaces. The server SDK
 * evaluates per request, so a pending snapshot is stale data; the web SDK
 * models it as a provider that is not ready.
 */
export enum PendingAs {
	Stale = "stale",
	NotReady = "not-ready",
}

type FlagMetadata = Record<string, boolean | string | number>;

/** Structurally the `ResolutionDetails` both OpenFeature SDKs expect. */
export interface OpenFeatureResolution<T, TErrorCode> {
	value: T;
	variant?: string;
	reason?: string;
	errorCode?: TErrorCode;
	errorMessage?: string;
	flagMetadata?: FlagMetadata;
}

/** OpenFeature's `StandardResolutionReasons`, shared by both SDKs. */
const Reason = {
	TargetingMatch: "TARGETING_MATCH",
	Cached: "CACHED",
	Disabled: "DISABLED",
	Stale: "STALE",
	Error: "ERROR",
} as const;

/** OpenFeature's `ErrorCode` values, shared by both SDKs. */
const ERROR_CODES: Record<EntitlementErrorCode, string> = {
	"not-found": "FLAG_NOT_FOUND",
	"type-mismatch": "TYPE_MISMATCH",
	"invalid-target": "INVALID_CONTEXT",
	unavailable: "GENERAL",
};
const PROVIDER_NOT_READY = "PROVIDER_NOT_READY";

/** `granted` values become a variant, e.g. `true` → `enabled`, `Infinity` → `unlimited`. */
function variantFor<T>(details: EntitlementDetails<T>): string | undefined {
	if (details.status === "disabled") {
		return "disabled";
	}

	if (details.status !== "granted") {
		return undefined;
	}

	const { value } = details;
	if (typeof value === "boolean") {
		return value ? "enabled" : "disabled";
	}

	if (value === Number.POSITIVE_INFINITY) {
		return "unlimited";
	}

	if (typeof value === "string" || typeof value === "number") {
		return String(value);
	}

	return details.entitlement?.value ?? "enabled";
}

/** Flattens the Chargebee entitlement into OpenFeature's primitive-only metadata. */
function metadataFor<T>(
	details: EntitlementDetails<T>,
): FlagMetadata | undefined {
	const { entitlement, source } = details;
	if (!entitlement) {
		return undefined;
	}

	const optional: Record<string, boolean | string | number | undefined> = {
		chargebeeValue: entitlement.value,
		chargebeeFeatureType: entitlement.featureType,
		chargebeeFeatureUnit: entitlement.featureUnit,
		chargebeeOverridden: entitlement.isOverridden,
		chargebeeExpiresAt: entitlement.expiresAt,
		cacheSource: source,
		unlimited: details.value === Number.POSITIVE_INFINITY ? true : undefined,
	};

	return {
		chargebeeFeatureId: entitlement.featureId,
		chargebeeEnabled: entitlement.isEnabled,
		...(Object.fromEntries(
			Object.entries(optional).filter(([, value]) => value !== undefined),
		) as FlagMetadata),
	};
}

function reasonFor<T>(details: EntitlementDetails<T>): string {
	switch (details.status) {
		case "granted":
			return details.source === "api" ? Reason.TargetingMatch : Reason.Cached;
		case "disabled":
			return Reason.Disabled;
		case "stale":
		case "pending":
			return Reason.Stale;
		case "error":
			return Reason.Error;
	}
}

/**
 * Maps SDK-agnostic {@link EntitlementDetails} onto OpenFeature's resolution
 * shape. The server and web SDKs declare structurally identical but
 * nominally distinct `ErrorCode` enums, so the target error code type is a
 * generic parameter instead of a hard dependency on either SDK package.
 */
export function toResolutionDetails<T, TErrorCode>(
	details: EntitlementDetails<T>,
	pendingAs: PendingAs,
): OpenFeatureResolution<T, TErrorCode> {
	const { value } = details;

	if (details.status === "pending" && pendingAs === PendingAs.NotReady) {
		return {
			value,
			reason: Reason.Error,
			errorCode: PROVIDER_NOT_READY as TErrorCode,
			errorMessage: "Chargebee entitlement snapshot is not loaded",
		};
	}

	if (details.status === "pending") {
		return {
			value,
			reason: Reason.Stale,
			flagMetadata: { snapshotPending: true },
		};
	}

	if (details.error) {
		return {
			value,
			reason: Reason.Error,
			errorCode: ERROR_CODES[details.error.code] as TErrorCode,
			errorMessage: details.error.message,
		};
	}

	return {
		value,
		variant: variantFor(details),
		reason: reasonFor(details),
		flagMetadata: metadataFor(details),
	};
}
