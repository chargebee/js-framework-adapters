import { z } from "zod";
import type {
	ChargebeeEntitlement,
	ChargebeeEntitlementsSnapshot,
	ChargebeeEvaluationMode,
} from "./types";

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
	return {
		schemaVersion: 1,
		generatedAt: new Date(now).toISOString(),
		expiresAt: new Date(now + ttlMs).toISOString(),
		targetMode,
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
