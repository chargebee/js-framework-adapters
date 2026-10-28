import type { ChargebeeEntitlementsSnapshot } from "../shared";
import type { EntitlementsStorage } from "./types";

export interface MemoryEntitlementsCacheOptions {
	maxEntries?: number;
	/** Expiry applied when `set` is called without one. Defaults to 60s. */
	ttlMs?: number;
	now?: () => number;
}

interface MemoryCacheEntry {
	snapshot: ChargebeeEntitlementsSnapshot;
	expiresAt: number;
}

export function createMemoryEntitlementsCache(
	options: MemoryEntitlementsCacheOptions = {},
): EntitlementsStorage {
	const maxEntries = options.maxEntries ?? 500;
	const ttlMs = options.ttlMs ?? 60_000;
	const now = options.now ?? Date.now;
	if (!Number.isInteger(maxEntries) || maxEntries < 1) {
		throw new Error("maxEntries must be a positive integer");
	}
	if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
		throw new Error("ttlMs must be a positive number");
	}

	const entries = new Map<string, MemoryCacheEntry>();

	return {
		async get(key) {
			const entry = entries.get(key);
			if (!entry) return undefined;

			if (entry.expiresAt <= now()) {
				entries.delete(key);
				return undefined;
			}

			// Moving a hit to the end makes Map insertion order an LRU list.
			entries.delete(key);
			entries.set(key, entry);
			return entry.snapshot;
		},

		async set(key, snapshot, entryTtlMs = ttlMs) {
			if (entryTtlMs <= 0) return;
			entries.delete(key);
			entries.set(key, {
				snapshot,
				expiresAt: now() + entryTtlMs,
			});

			while (entries.size > maxEntries) {
				const oldestKey = entries.keys().next().value;
				if (oldestKey === undefined) return;
				entries.delete(oldestKey);
			}
		},

		async delete(key) {
			entries.delete(key);
		},

		async clear() {
			entries.clear();
		},
	};
}
