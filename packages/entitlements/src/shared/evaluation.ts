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

/** The value shapes a Chargebee entitlement can be read as. */
type ValueKind = "boolean" | "string" | "number" | "object";

const BOOLEAN_VALUES = new Set(["true", "false", "available"]);

/**
 * The shape to parse an entitlement into. Chargebee stores every value as a
 * string, so something has to decide whether `"42"` is a number or a string,
 * and TypeScript generics are gone by the time this runs. The default value
 * answers it: because it is typed as `T`, its runtime type is always the
 * declared one.
 */
function kindOf(defaultValue: unknown): ValueKind {
	const kind = typeof defaultValue;
	return kind === "boolean" || kind === "string" || kind === "number"
		? kind
		: "object";
}

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

function getEnabled<T>(
	snapshot: ChargebeeEntitlementsSnapshot,
	featureId: string,
	defaultValue: T,
	source: SnapshotSource,
): EnabledEntitlement | EntitlementResolution<T> {
	const entitlement = snapshot.entitlements[featureId];
	if (!entitlement) {
		return errorResolution(
			defaultValue,
			"FLAG_NOT_FOUND",
			`Chargebee feature ${featureId} was not found`,
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

interface ParsedEntitlementValue {
	value: unknown;
	variant?: string;
	extraMetadata?: Record<string, boolean | string | number>;
	error?: { code: EntitlementErrorCode; message: string };
}

function parseEntitlementValue(
	entitlement: ChargebeeEntitlement,
	kind: ValueKind,
	featureId: string,
): ParsedEntitlementValue {
	switch (kind) {
		case "boolean": {
			const normalized = entitlement.value?.trim().toLowerCase();
			if (
				!normalized &&
				(entitlement.featureType === undefined ||
					entitlement.featureType === "switch")
			) {
				return { value: true, variant: "enabled" };
			}
			if (!BOOLEAN_VALUES.has(normalized ?? "")) {
				return {
					value: undefined,
					error: {
						code: "TYPE_MISMATCH",
						message: `Chargebee feature ${featureId} is not a boolean entitlement`,
					},
				};
			}
			const value = normalized === "true" || normalized === "available";
			return { value, variant: value ? "enabled" : "disabled" };
		}
		case "string": {
			const value = entitlement.value;
			if (value === undefined) {
				return {
					value: undefined,
					error: {
						code: "PARSE_ERROR",
						message: `Chargebee feature ${featureId} has no value`,
					},
				};
			}
			return { value, variant: value };
		}
		case "number": {
			const rawValue = entitlement.value?.trim();
			if (rawValue?.toLowerCase() === "unlimited") {
				return {
					value: Number.POSITIVE_INFINITY,
					variant: "unlimited",
					extraMetadata: { unlimited: true },
				};
			}
			const value = rawValue ? Number(rawValue) : Number.NaN;
			if (!Number.isFinite(value)) {
				return {
					value: undefined,
					error: {
						code: "TYPE_MISMATCH",
						message: `Chargebee feature ${featureId} is not a numeric entitlement`,
					},
				};
			}
			return { value, variant: rawValue };
		}
		case "object":
			return {
				value: entitlement,
				variant: entitlement.value ?? "enabled",
			};
	}
}

/**
 * Resolves an entitlement into whatever shape `defaultValue` declares, and
 * falls back to that default when the feature is missing, disabled, expired,
 * or holds a value of another shape.
 */
export function resolveEntitlement<T>(
	snapshot: ChargebeeEntitlementsSnapshot,
	featureId: string,
	defaultValue: T,
	source: SnapshotSource,
): EntitlementResolution<T> {
	const found = getEnabled(snapshot, featureId, defaultValue, source);
	if (!("entitlement" in found)) return found;

	const parsed = parseEntitlementValue(
		found.entitlement,
		kindOf(defaultValue),
		featureId,
	);
	if (parsed.error) {
		return errorResolution(
			defaultValue,
			parsed.error.code,
			parsed.error.message,
		);
	}

	return {
		value: parsed.value as T,
		variant: parsed.variant,
		reason: reasonFor(source),
		flagMetadata: parsed.extraMetadata
			? { ...found.metadata, ...parsed.extraMetadata }
			: found.metadata,
	};
}
