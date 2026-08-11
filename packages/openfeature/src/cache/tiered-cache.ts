import type { ChargebeeEntitlementsSnapshot } from "../shared.js";
import { MemoryEntitlementsCache } from "./memory.js";
import type { CacheLookup, EntitlementsCache } from "./types.js";

export interface TieredEntitlementsCacheOptions {
	memory?: EntitlementsCache;
	redis?: EntitlementsCache;
	memoryTtlMs?: number;
	redisTtlMs?: number;
	onError?: (error: unknown, tier: "memory" | "redis") => void;
}

export class TieredEntitlementsCache {
	private readonly memory: EntitlementsCache;
	private readonly redis?: EntitlementsCache;
	private readonly memoryTtlMs: number;
	private readonly redisTtlMs: number;
	private readonly onError?: (error: unknown, tier: "memory" | "redis") => void;

	constructor(options: TieredEntitlementsCacheOptions = {}) {
		this.memory = options.memory ?? new MemoryEntitlementsCache();
		this.redis = options.redis;
		this.memoryTtlMs = options.memoryTtlMs ?? 30_000;
		this.redisTtlMs = options.redisTtlMs ?? 300_000;
		this.onError = options.onError;
	}

	get snapshotTtlMs(): number {
		return this.redis ? this.redisTtlMs : this.memoryTtlMs;
	}

	async get(key: string): Promise<CacheLookup | undefined> {
		try {
			const snapshot = await this.memory.get(key);
			if (snapshot) return { snapshot, source: "memory" };
		} catch (error) {
			this.onError?.(error, "memory");
		}

		if (!this.redis) return undefined;
		try {
			const snapshot = await this.redis.get(key);
			if (!snapshot) return undefined;
			try {
				await this.memory.set(
					key,
					snapshot,
					Math.min(
						this.memoryTtlMs,
						Date.parse(snapshot.expiresAt) - Date.now(),
					),
				);
			} catch (memoryError) {
				this.onError?.(memoryError, "memory");
			}
			return { snapshot, source: "redis" };
		} catch (error) {
			this.onError?.(error, "redis");
			return undefined;
		}
	}

	async set(
		key: string,
		snapshot: ChargebeeEntitlementsSnapshot,
	): Promise<void> {
		if (this.redis) {
			try {
				await this.redis.set(key, snapshot, this.redisTtlMs);
			} catch (error) {
				this.onError?.(error, "redis");
			}
		}

		try {
			await this.memory.set(key, snapshot, this.memoryTtlMs);
		} catch (error) {
			this.onError?.(error, "memory");
		}
	}

	async delete(key: string): Promise<void> {
		const remove = async (
			cache: EntitlementsCache,
			tier: "memory" | "redis",
		) => {
			try {
				await cache.delete(key);
			} catch (error) {
				this.onError?.(error, tier);
			}
		};

		await Promise.all([
			remove(this.memory, "memory"),
			...(this.redis ? [remove(this.redis, "redis")] : []),
		]);
	}

	async clearMemory(): Promise<void> {
		await this.memory.clear?.();
	}
}
