import { createMemoryEntitlementsCache } from "@chargebee/entitlements/cache";
import { ChargebeeEntitlements } from "@chargebee/entitlements/server";
import { createChargebee } from "./chargebee.ts";

const CACHE_TTL_MS = 30_000;

/**
 * One client per process. The memory cache absorbs repeat checks, so a
 * customer's entitlements are fetched from Chargebee once per `CACHE_TTL_MS`.
 */
export const entitlements = new ChargebeeEntitlements({
	chargebeeClient: createChargebee(),
	cache: createMemoryEntitlementsCache({ ttlMs: CACHE_TTL_MS }),
	onError: (error, { operation, target }) => {
		console.error(`[entitlements] ${operation} failed`, target, error);
	},
});

// Defaults apply when Chargebee has no usable value, so they match the lowest tier.
export const advancedReports = entitlements.feature("advanced-reports", false);
export const licensedSeats = entitlements.feature("licensed-seats", 1);
export const apiCalls = entitlements.feature("api-calls", 100);
export const supportTier = entitlements.feature("support-tier", "community");

export const FEATURES = [advancedReports, licensedSeats, apiCalls, supportTier];
