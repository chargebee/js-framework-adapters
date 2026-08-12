import type {
	ChargebeeEntitlement,
	ChargebeeEntitlementsSnapshot,
	EntitlementErrorCode,
	EntitlementResolution,
	SnapshotSource,
} from "./types";

type EnabledEntitlement = {
	entitlement: ChargebeeEntitlement;
	metadata: Record<string, boolean | string | number>;
};

function metadataFor(
	entitlement: ChargebeeEntitlement,
	source: SnapshotSource,
): Record<string, boolean | string | number> {
	return {
		chargebeeFeatureId: entitlement.featureId,
		chargebeeEnabled: entitlement.isEnabled,
		cacheSource: source,
		...(entitlement.value !== undefined
			? { chargebeeValue: entitlement.value }
			: {}),
		...(entitlement.featureType !== undefined
			? { chargebeeFeatureType: entitlement.featureType }
			: {}),
		...(entitlement.featureUnit !== undefined
			? { chargebeeFeatureUnit: entitlement.featureUnit }
			: {}),
		...(entitlement.isOverridden !== undefined
			? { chargebeeOverridden: entitlement.isOverridden }
			: {}),
		...(entitlement.expiresAt !== undefined
			? { chargebeeExpiresAt: entitlement.expiresAt }
			: {}),
	};
}

export function errorResolution<T>(
	value: T,
	errorCode: EntitlementErrorCode,
	errorMessage: string,
): EntitlementResolution<T> {
	return { value, reason: "ERROR", errorCode, errorMessage };
}

/**
 * Adapts an SDK-agnostic {@link EntitlementResolution} into the
 * `ResolutionDetails` shape both OpenFeature SDKs expect. The server and web
 * SDKs declare structurally identical but nominally distinct `ErrorCode`
 * enums, so the target error code type is a generic parameter instead of a
 * hard dependency on either SDK package.
 */
export function toResolutionDetails<T, TErrorCode>(
	resolution: EntitlementResolution<T>,
): Omit<EntitlementResolution<T>, "errorCode"> & { errorCode?: TErrorCode } {
	return {
		...resolution,
		errorCode: resolution.errorCode as unknown as TErrorCode | undefined,
	};
}

function getEnabled<T>(
	snapshot: ChargebeeEntitlementsSnapshot,
	flagKey: string,
	defaultValue: T,
	source: SnapshotSource,
): EnabledEntitlement | EntitlementResolution<T> {
	const entitlement = snapshot.entitlements[flagKey];
	if (!entitlement) {
		return errorResolution(
			defaultValue,
			"FLAG_NOT_FOUND",
			`Chargebee feature ${flagKey} was not found`,
		);
	}

	const metadata = metadataFor(entitlement, source);
	const expired =
		entitlement.expiresAt !== undefined &&
		entitlement.expiresAt * 1000 <= Date.now();
	if (!entitlement.isEnabled || expired) {
		return {
			value: defaultValue,
			variant: "disabled",
			reason: "DISABLED",
			flagMetadata: metadata,
		};
	}

	return { entitlement, metadata };
}

const reasonFor = (source: SnapshotSource) =>
	source === "api" ? "TARGETING_MATCH" : "CACHED";

export function resolveBooleanEntitlement(
	snapshot: ChargebeeEntitlementsSnapshot,
	flagKey: string,
	defaultValue: boolean,
	source: SnapshotSource,
): EntitlementResolution<boolean> {
	const found = getEnabled(snapshot, flagKey, defaultValue, source);
	if (!("entitlement" in found)) return found;

	const normalized = found.entitlement.value?.trim().toLowerCase();
	if (
		!normalized &&
		(found.entitlement.featureType === undefined ||
			found.entitlement.featureType === "switch")
	) {
		return {
			value: true,
			variant: "enabled",
			reason: reasonFor(source),
			flagMetadata: found.metadata,
		};
	}
	if (!["true", "false", "available"].includes(normalized ?? "")) {
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
		reason: reasonFor(source),
		flagMetadata: found.metadata,
	};
}

export function resolveStringEntitlement(
	snapshot: ChargebeeEntitlementsSnapshot,
	flagKey: string,
	defaultValue: string,
	source: SnapshotSource,
): EntitlementResolution<string> {
	const found = getEnabled(snapshot, flagKey, defaultValue, source);
	if (!("entitlement" in found)) return found;

	const value = found.entitlement.value;
	if (value === undefined) {
		return errorResolution(
			defaultValue,
			"PARSE_ERROR",
			`Chargebee feature ${flagKey} has no value`,
		);
	}

	return {
		value,
		variant: value,
		reason: reasonFor(source),
		flagMetadata: found.metadata,
	};
}

export function resolveNumberEntitlement(
	snapshot: ChargebeeEntitlementsSnapshot,
	flagKey: string,
	defaultValue: number,
	source: SnapshotSource,
): EntitlementResolution<number> {
	const found = getEnabled(snapshot, flagKey, defaultValue, source);
	if (!("entitlement" in found)) return found;

	const rawValue = found.entitlement.value?.trim();
	if (rawValue?.toLowerCase() === "unlimited") {
		return {
			value: Number.POSITIVE_INFINITY,
			variant: "unlimited",
			reason: reasonFor(source),
			flagMetadata: { ...found.metadata, unlimited: true },
		};
	}

	const value = rawValue ? Number(rawValue) : Number.NaN;
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
		reason: reasonFor(source),
		flagMetadata: found.metadata,
	};
}

export function resolveObjectEntitlement<T>(
	snapshot: ChargebeeEntitlementsSnapshot,
	flagKey: string,
	defaultValue: T,
	source: SnapshotSource,
): EntitlementResolution<T> {
	const found = getEnabled(snapshot, flagKey, defaultValue, source);
	if (!("entitlement" in found)) return found;

	return {
		value: found.entitlement as unknown as T,
		variant: found.entitlement.value ?? "enabled",
		reason: reasonFor(source),
		flagMetadata: found.metadata,
	};
}
