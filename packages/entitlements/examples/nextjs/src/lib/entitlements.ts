import "server-only";

import type { Feature } from "@chargebee/entitlements";
import { createMemoryEntitlementsCache } from "@chargebee/entitlements/cache";
import {
	ChargebeeEntitlements,
	type ScopedEntitlements,
} from "@chargebee/entitlements/server";
import { createChargebee } from "./chargebee";
import type { User } from "./users";

const CACHE_TTL_MS = 30_000;

/** Chargebee API errors are plain objects with a `message`, not `Error`s. */
function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return (error as { message?: string } | undefined)?.message ?? String(error);
}

const globalForEntitlements = globalThis as {
	chargebeeEntitlements?: ChargebeeEntitlements;
};

/**
 * One client per process. Kept on `globalThis` so dev hot reloads reuse it
 * and its cache instead of refetching from Chargebee.
 */
globalForEntitlements.chargebeeEntitlements ??= new ChargebeeEntitlements({
	chargebeeClient: createChargebee(),
	cache: createMemoryEntitlementsCache({ ttlMs: CACHE_TTL_MS }),
	// A warning, not `console.error`: Next.js dev shows errors in an overlay,
	// and the demo's missing customer fails on purpose.
	onError: (error, { operation, target }) => {
		console.warn(
			`[entitlements] ${operation} failed for ${JSON.stringify(target)}: ${errorMessage(error)}`,
		);
	},
});

export const entitlements = globalForEntitlements.chargebeeEntitlements;

/** The server client bound to the user's Chargebee customer. */
export function entitlementsFor(user: User): ScopedEntitlements {
	return entitlements.for({ customerId: user.chargebeeCustomerId });
}

/** Whether the user is entitled to a switch feature. */
export function hasFeature(
	user: User,
	feature: Feature<boolean>,
): Promise<boolean> {
	return entitlementsFor(user).get(feature.featureId, feature.defaultValue);
}
