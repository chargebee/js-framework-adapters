import {
	type ChargebeeEntitlementsSnapshot,
	isSnapshotExpired,
} from "../shared";
import type { EntitlementsCache } from "./types";

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

		// Moving a hit to the end makes Map insertion order an LRU list.
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.snapshot;
	}

	async set(
		key: string,
		snapshot: ChargebeeEntitlementsSnapshot,
		ttlMs: number,
	): Promise<void> {
		if (ttlMs <= 0) return;
		this.entries.delete(key);
		this.entries.set(key, {
			snapshot,
			expiresAt: this.now() + ttlMs,
		});

		while (this.entries.size > this.maxEntries) {
			const oldestKey = this.entries.keys().next().value;
			if (oldestKey === undefined) return;
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
