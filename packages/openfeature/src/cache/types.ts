import type { ChargebeeEntitlementsSnapshot } from "../shared";

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

export interface RedisCacheCommands {
	get(key: string): Promise<string | null | undefined>;
	set(key: string, value: string, ttlMs: number): Promise<void>;
	delete(key: string): Promise<void>;
}
