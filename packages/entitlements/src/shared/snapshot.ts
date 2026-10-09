import type {
	ChargebeeEntitlement,
	ChargebeeEntitlementsSnapshot,
} from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIsoDate(value: unknown): value is string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validateEntitlement(
	key: string,
	value: unknown,
): ChargebeeEntitlement {
	if (!isObject(value)) {
		throw new Error(`Invalid entitlement for feature "${key}"`);
	}
	const { featureId, isEnabled } = value;
	if (typeof featureId !== "string" || featureId.length === 0) {
		throw new Error(`Invalid or missing featureId in entitlement for "${key}"`);
	}
	if (typeof isEnabled !== "boolean") {
		throw new Error(`Invalid or missing isEnabled in entitlement for "${key}"`);
	}
	return value as unknown as ChargebeeEntitlement;
}

export function parseEntitlementsSnapshot(
	input: unknown,
): ChargebeeEntitlementsSnapshot {
	if (!isObject(input)) {
		throw new Error("Invalid entitlements snapshot: expected an object");
	}

	const { schemaVersion, generatedAt, expiresAt, entitlements } = input;

	if (schemaVersion !== 1) {
		throw new Error(
			`Unsupported snapshot schemaVersion: ${String(schemaVersion)}`,
		);
	}
	if (!isValidIsoDate(generatedAt)) {
		throw new Error("Invalid snapshot generatedAt timestamp");
	}
	if (!isValidIsoDate(expiresAt)) {
		throw new Error("Invalid snapshot expiresAt timestamp");
	}
	if (!isObject(entitlements)) {
		throw new Error("Invalid snapshot entitlements map");
	}

	for (const [key, ent] of Object.entries(entitlements)) {
		validateEntitlement(key, ent);
	}

	return input as unknown as ChargebeeEntitlementsSnapshot;
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
	entitlements: Iterable<ChargebeeEntitlement>,
	ttlMs: number,
	now = Date.now(),
): ChargebeeEntitlementsSnapshot {
	return {
		schemaVersion: 1,
		generatedAt: new Date(now).toISOString(),
		expiresAt: new Date(now + ttlMs).toISOString(),
		entitlements: Object.fromEntries(
			[...entitlements].map((entitlement) => [
				entitlement.featureId,
				entitlement,
			]),
		),
	};
}

export function isSnapshotExpired(
	snapshot: ChargebeeEntitlementsSnapshot,
	now = Date.now(),
): boolean {
	return Date.parse(snapshot.expiresAt) <= now;
}
