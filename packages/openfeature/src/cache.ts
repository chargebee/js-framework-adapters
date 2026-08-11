import {
	type ChargebeeEntitlementsSnapshot,
	type ChargebeeTarget,
	isSnapshotExpired,
	parseSerializedEntitlementsSnapshot,
	serializeEntitlementsSnapshot,
} from "./shared";

export interface EntitlementsCache {
	get(key: string): Promise<ChargebeeEntitlementsSnapshot | undefined>;
	set(
		key: string,
		value: ChargebeeEntitlementsSnapshot,
		ttlMs: number,
	): Promise<void>;
	delete(key: string): Promise<void>;
	clear?(): Promise<void>;
}

export interface CacheLookup {
	snapshot: ChargebeeEntitlementsSnapshot;
	source: "memory" | "redis";
}

export interface MemoryEntitlementsCacheOptions {
	maxEntries?: number;
	now?: () => number;
}

interface MemoryCacheEntry {
	snapshot: ChargebeeEntitlementsSnapshot;
	expiresAt: number;
}

export class MemoryEntitlementsCache implements EntitlementsCache {
	private readonly entries = new Map<string, MemoryCacheEntry>();
	private readonly maxEntries: number;
	private readonly now: () => number;

	constructor(options: MemoryEntitlementsCacheOptions = {}) {
		this.maxEntries = options.maxEntries ?? 500;
		this.now = options.now ?? Date.now;
		if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
			throw new Error("maxEntries must be a positive integer");
		}
	}

	async get(key: string): Promise<ChargebeeEntitlementsSnapshot | undefined> {
		const entry = this.entries.get(key);
		if (!entry) return undefined;

		if (
			entry.expiresAt <= this.now() ||
			isSnapshotExpired(entry.snapshot, this.now())
		) {
			this.entries.delete(key);
			return undefined;
		}

		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.snapshot;
	}

	async set(
		key: string,
		value: ChargebeeEntitlementsSnapshot,
		ttlMs: number,
	): Promise<void> {
		if (ttlMs <= 0) return;
		this.entries.delete(key);
		this.entries.set(key, {
			snapshot: value,
			expiresAt: this.now() + ttlMs,
		});

		while (this.entries.size > this.maxEntries) {
			const oldestKey = this.entries.keys().next().value;
			if (oldestKey === undefined) break;
			this.entries.delete(oldestKey);
		}
	}

	async delete(key: string): Promise<void> {
		this.entries.delete(key);
	}

	async clear(): Promise<void> {
		this.entries.clear();
	}
}

export interface RedisCacheCommands {
	get(key: string): Promise<string | null | undefined>;
	set(key: string, value: string, ttlMs: number): Promise<void>;
	delete(key: string): Promise<void>;
}

export function createRedisEntitlementsCache(
	commands: RedisCacheCommands,
): EntitlementsCache {
	return {
		async get(key) {
			const value = await commands.get(key);
			if (value == null) return undefined;

			try {
				const snapshot = parseSerializedEntitlementsSnapshot(value);
				if (isSnapshotExpired(snapshot)) {
					await commands.delete(key);
					return undefined;
				}
				return snapshot;
			} catch {
				await commands.delete(key);
				return undefined;
			}
		},
		async set(key, value, ttlMs) {
			await commands.set(key, serializeEntitlementsSnapshot(value), ttlMs);
		},
		async delete(key) {
			await commands.delete(key);
		},
	};
}

export interface LayeredEntitlementsCacheOptions {
	memory?: EntitlementsCache;
	redis?: EntitlementsCache;
	memoryTtlMs?: number;
	redisTtlMs?: number;
	onError?: (error: unknown, layer: "memory" | "redis") => void;
}

export class LayeredEntitlementsCache {
	private readonly memory: EntitlementsCache;
	private readonly redis?: EntitlementsCache;
	private readonly memoryTtlMs: number;
	private readonly redisTtlMs: number;
	private readonly onError?: (
		error: unknown,
		layer: "memory" | "redis",
	) => void;

	constructor(options: LayeredEntitlementsCacheOptions = {}) {
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
			const memoryValue = await this.memory.get(key);
			if (memoryValue) return { snapshot: memoryValue, source: "memory" };
		} catch (error) {
			this.onError?.(error, "memory");
		}

		if (!this.redis) return undefined;
		try {
			const redisValue = await this.redis.get(key);
			if (!redisValue) return undefined;
			const remainingTtl = Date.parse(redisValue.expiresAt) - Date.now();
			await this.memory.set(
				key,
				redisValue,
				Math.min(this.memoryTtlMs, remainingTtl),
			);
			return { snapshot: redisValue, source: "redis" };
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
		const deletions: Promise<void>[] = [
			this.memory.delete(key).catch((error) => {
				this.onError?.(error, "memory");
			}),
		];
		if (this.redis) {
			deletions.push(
				this.redis.delete(key).catch((error) => {
					this.onError?.(error, "redis");
				}),
			);
		}
		await Promise.all(deletions);
	}

	async clearMemory(): Promise<void> {
		await this.memory.clear?.();
	}
}

export function createEntitlementsCacheKey(
	target: ChargebeeTarget,
	options: {
		namespace?: string;
		consolidateCustomerEntitlements?: boolean;
	} = {},
): string {
	const namespace = options.namespace ?? "chargebee:openfeature:v1";
	const consolidated = options.consolidateCustomerEntitlements ?? true;
	if (target.mode === "customer") {
		return `${namespace}:customer:${encodeURIComponent(target.customerId)}:${consolidated ? "consolidated" : "individual"}`;
	}
	return `${namespace}:subscription:${encodeURIComponent(target.subscriptionId)}`;
}
