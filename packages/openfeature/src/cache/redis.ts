import {
	isSnapshotExpired,
	parseSerializedEntitlementsSnapshot,
	serializeEntitlementsSnapshot,
} from "../shared";
import type { EntitlementsCache, RedisCacheCommands } from "./types";

export function createRedisEntitlementsCache(
	commands: RedisCacheCommands,
): EntitlementsCache {
	return {
		async get(key) {
			const value = await commands.get(key);
			if (value == null) return undefined;

			try {
				const snapshot = parseSerializedEntitlementsSnapshot(value);
				if (!isSnapshotExpired(snapshot)) return snapshot;
			} catch {
				// Corrupt or old cache values are treated as misses.
			}

			await commands.delete(key);
			return undefined;
		},
		async set(key, value, ttlMs) {
			await commands.set(key, serializeEntitlementsSnapshot(value), ttlMs);
		},
		delete: (key) => commands.delete(key),
	};
}
