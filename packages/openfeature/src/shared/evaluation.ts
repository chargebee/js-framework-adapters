import type {
	ChargebeeEntitlement,
	ChargebeeEntitlementsSnapshot,
	EntitlementCacheSource,
	EntitlementErrorCode,
	EntitlementResolution,
} from "./types";

type EnabledEntitlement = {
	entitlement: ChargebeeEntitlement;
	metadata: Record<string, boolean | string | number>;
};

function metadataFor(
	entitlement: ChargebeeEntitlement,
	source: EntitlementCacheSource,
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

function error<T>(
	value: T,
	errorCode: EntitlementErrorCode,
	errorMessage: string,
): EntitlementResolution<T> {
	return { value, reason: "ERROR", errorCode, errorMessage };
}

function getEnabled<T>(
	snapshot: ChargebeeEntitlementsSnapshot,
	flagKey: string,
	defaultValue: T,
	source: EntitlementCacheSource,
): EnabledEntitlement | EntitlementResolution<T> {
	const entitlement = snapshot.entitlements[flagKey];
	if (!entitlement) {
		return error(
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

const reasonFor = (source: EntitlementCacheSource) =>
	source === "api" ? "TARGETING_MATCH" : "CACHED";

export function resolveBooleanEntitlement(
	snapshot: ChargebeeEntitlementsSnapshot,
	flagKey: string,
	defaultValue: boolean,
	source: EntitlementCacheSource,
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
		return error(
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
	source: EntitlementCacheSource,
): EntitlementResolution<string> {
	const found = getEnabled(snapshot, flagKey, defaultValue, source);
	if (!("entitlement" in found)) return found;

	const value = found.entitlement.value;
	if (value === undefined) {
		return error(
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
	source: EntitlementCacheSource,
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
		return error(
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
	source: EntitlementCacheSource,
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
