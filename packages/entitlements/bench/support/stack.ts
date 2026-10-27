import Redis from "ioredis";
import { Pool } from "pg";
import {
	createEntitlementsCacheKey,
	createRedisEntitlementsCache,
	type EntitlementsStorage,
} from "../../src/cache";
import {
	ChargebeeEntitlements,
	type ChargebeeEntitlementsOptions,
} from "../../src/server";
import type { ChargebeeTarget } from "../../src/shared";
import { createMockChargebee } from "./chargebee";
import {
	CHARGEBEE_DELAY_MS,
	POSTGRES_DELAY_MS,
	POSTGRES_URL,
	ProxyName,
	REDIS_DELAY_MS,
	REDIS_URL,
} from "./config";
import { setLatency } from "./network";
import { createPostgresStore, migrate } from "./postgres";

// Outlasts a run, so stored snapshots never trigger background refreshes.
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;

/**
 * Production-shaped setup: Redis cache, Postgres store, mock Chargebee.
 *
 *   ChargebeeEntitlements ──► Redis ──► Postgres ──► Chargebee (mock)
 *
 * `blocking` waits for Chargebee on a miss; `background` answers `pending`.
 */
export class BenchStack {
	readonly blocking: ChargebeeEntitlements;
	readonly background: ChargebeeEntitlements;
	private readonly cache: EntitlementsStorage;
	private readonly refreshWaiters: Array<() => void> = [];

	private constructor(
		private readonly redis: Redis,
		private readonly pool: Pool,
	) {
		this.cache = createRedisEntitlementsCache(redis);

		const options: ChargebeeEntitlementsOptions = {
			chargebeeClient: createMockChargebee(CHARGEBEE_DELAY_MS),
			cache: this.cache,
			durableStore: createPostgresStore(pool),
			snapshotTtlMs: SNAPSHOT_TTL_MS,
			onError: (error, info) => {
				console.error(`${info.operation} failed`, error);
			},
		};

		this.blocking = new ChargebeeEntitlements({
			...options,
			refreshOnMiss: "blocking",
		});

		// Background refreshes finish after the call returns; waiters learn when.
		this.background = new ChargebeeEntitlements({
			...options,
			refreshOnMiss: "background",
			onSnapshotRefreshed: () => this.settleRefresh(),
			onError: (error, info) => {
				options.onError?.(error, info);
				this.settleRefresh();
			},
		});
	}

	static async start(): Promise<BenchStack> {
		await setLatency(ProxyName.Redis, REDIS_DELAY_MS);
		await setLatency(ProxyName.Postgres, POSTGRES_DELAY_MS);

		const redis = new Redis(REDIS_URL);
		const pool = new Pool({ connectionString: POSTGRES_URL });

		// Start empty, so leftovers from earlier runs can't change the paths taken.
		await redis.flushdb();
		await migrate(pool);
		await createPostgresStore(pool).clear?.();

		return new BenchStack(redis, pool);
	}

	/** Loads the snapshot into Redis and Postgres. */
	async prime(target: ChargebeeTarget): Promise<void> {
		await this.blocking.getSnapshot(target);
	}

	/** Drops the Redis copy only, so the next read falls through to Postgres. */
	async evictCache(target: ChargebeeTarget): Promise<void> {
		await this.cache.delete(createEntitlementsCacheKey(target));
	}

	/** Drops the snapshot from Redis and Postgres. */
	async forget(target: ChargebeeTarget): Promise<void> {
		await this.blocking.deleteSnapshot(target);
	}

	/** Resolves when the next background refresh lands or fails. */
	nextRefresh(): Promise<void> {
		return new Promise((resolve) => this.refreshWaiters.push(resolve));
	}

	async close(): Promise<void> {
		await this.blocking.close();
		await this.background.close();
		await this.redis.quit();
		await this.pool.end();
	}

	private settleRefresh(): void {
		for (const resolve of this.refreshWaiters.splice(0)) {
			resolve();
		}
	}
}
