import type Redis from "ioredis";
import type { ChargebeeEntitlementsSnapshot } from "../shared";

/**
 * Storage contract shared by the fast shared cache and the durable snapshot
 * store. Implement it over Redis, PostgreSQL, or any other backend.
 */
export interface EntitlementsStorage {
	get(key: string): Promise<ChargebeeEntitlementsSnapshot | undefined>;
	/**
	 * Stores a snapshot. `ttlMs` is the caller's requested expiry; an
	 * implementation configured with its own TTL applies that when omitted.
	 */
	set(
		key: string,
		value: ChargebeeEntitlementsSnapshot,
		ttlMs?: number,
	): Promise<void>;
	delete(key: string): Promise<void>;
	clear?(): Promise<void>;
}

/** The subset of an ioredis `Redis` client that `createRedisEntitlementsCache` needs. */
export type RedisEntitlementsCacheClient = Pick<Redis, "get" | "set" | "del">;
