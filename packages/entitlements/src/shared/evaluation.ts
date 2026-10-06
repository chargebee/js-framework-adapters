import type {
	ChargebeeEntitlement,
	ChargebeeEntitlementsSnapshot,
	EntitlementDetails,
	EntitlementError,
	EntitlementErrorCode,
	SnapshotSource,
} from "./types";

/** The value shapes a Chargebee entitlement can be read as. */
type ValueKind = "boolean" | "string" | "number" | "object";

type ParsedValue = { value: unknown } | { error: EntitlementError };

const BOOLEAN_VALUES = new Set(["true", "false", "available"]);
const TRUE_VALUES = new Set(["true", "available"]);
const UNLIMITED = "unlimited";
const MS_PER_SECOND = 1000;

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

export function errorDetails<T>(
	value: T,
	code: EntitlementErrorCode,
	message: string,
): EntitlementDetails<T> {
	return { value, status: "error", error: { code, message } };
}

/** Disabled and expired (`expiresAt` is in Unix seconds) entitlements grant nothing. */
function isActive(entitlement: ChargebeeEntitlement): boolean {
	if (!entitlement.isEnabled) {
		return false;
	}

	return (
		entitlement.expiresAt === undefined ||
		entitlement.expiresAt * MS_PER_SECOND > Date.now()
	);
}

const mismatch = (featureId: string, kind: ValueKind): ParsedValue => ({
	error: {
		code: "type-mismatch",
		message: `Chargebee feature ${featureId} is not a ${kind} entitlement`,
	},
});

/**
 * Reads an entitlement's string value as `kind`, e.g. for `kind` `number`:
 * `"25"` → `25`, `"unlimited"` → `Infinity`, `"priority"` → type mismatch.
 */
function parseValue(
	entitlement: ChargebeeEntitlement,
	kind: ValueKind,
	featureId: string,
): ParsedValue {
	switch (kind) {
		case "boolean": {
			const normalized = entitlement.value?.trim().toLowerCase();

			// A switch granted without a value is simply on.
			const bareSwitch =
				entitlement.featureType === undefined ||
				entitlement.featureType === "switch";
			if (!normalized && bareSwitch) {
				return { value: true };
			}

			if (!BOOLEAN_VALUES.has(normalized ?? "")) {
				return mismatch(featureId, kind);
			}

			return { value: TRUE_VALUES.has(normalized ?? "") };
		}
		case "string": {
			if (entitlement.value === undefined) {
				return mismatch(featureId, kind);
			}

			return { value: entitlement.value };
		}
		case "number": {
			const rawValue = entitlement.value?.trim();
			if (rawValue?.toLowerCase() === UNLIMITED) {
				return { value: Number.POSITIVE_INFINITY };
			}

			const value = rawValue ? Number(rawValue) : Number.NaN;
			if (!Number.isFinite(value)) {
				return mismatch(featureId, kind);
			}

			return { value };
		}
		case "object":
			return { value: entitlement };
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
): EntitlementDetails<T> {
	const entitlement = snapshot.entitlements[featureId];
	if (!entitlement) {
		return {
			...errorDetails(
				defaultValue,
				"not-found",
				`Chargebee feature ${featureId} was not found`,
			),
			source,
		};
	}

	if (!isActive(entitlement)) {
		return { value: defaultValue, status: "disabled", source, entitlement };
	}

	const parsed = parseValue(entitlement, kindOf(defaultValue), featureId);
	if ("error" in parsed) {
		return {
			value: defaultValue,
			status: "error",
			source,
			entitlement,
			error: parsed.error,
		};
	}

	return { value: parsed.value as T, status: "granted", source, entitlement };
}
