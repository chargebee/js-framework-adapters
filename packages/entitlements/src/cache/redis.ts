import {
	parseSerializedEntitlementsSnapshot,
	serializeEntitlementsSnapshot,
} from "../shared";
import type {
	EntitlementsStorage,
	RedisEntitlementsCacheClient,
} from "./types";

export interface RedisEntitlementsCacheOptions {
	/** Expiry applied when `set` is called without one. Defaults to 60s. */
	ttlMs?: number;
}

export function createRedisEntitlementsCache(
	client: RedisEntitlementsCacheClient,
	options: RedisEntitlementsCacheOptions = {},
): EntitlementsStorage {
	const defaultTtlMs = options.ttlMs ?? 60_000;
	if (!Number.isFinite(defaultTtlMs) || defaultTtlMs <= 0) {
		throw new Error("ttlMs must be a positive number");
	}

	return {
		async get(key) {
			const value = await client.get(key);
			if (value == null) return undefined;

			try {
				return parseSerializedEntitlementsSnapshot(value);
			} catch {
				// Corrupt or old cache values are treated as misses.
				await client.del(key);
				return undefined;
			}
		},
		async set(key, value, ttlMs = defaultTtlMs) {
			await client.set(key, serializeEntitlementsSnapshot(value), "PX", ttlMs);
		},
		async delete(key) {
			await client.del(key);
		},
	};
}
