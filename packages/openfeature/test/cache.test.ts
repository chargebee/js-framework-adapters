import {
	createRedisEntitlementsCache,
	LayeredEntitlementsCache,
	MemoryEntitlementsCache,
} from "../src/cache";
import { createEntitlementsSnapshot } from "../src/shared";

function makeSnapshot(ttlMs = 60_000) {
	return createEntitlementsSnapshot(
		"customer",
		[{ featureId: "sso", value: "true", isEnabled: true }],
		ttlMs,
	);
}

describe("MemoryEntitlementsCache", () => {
	it("expires entries and evicts the least recently used entry", async () => {
		let now = 1_000;
		const cache = new MemoryEntitlementsCache({
			maxEntries: 2,
			now: () => now,
		});
		const snapshot = makeSnapshot();

		await cache.set("a", snapshot, 100);
		await cache.set("b", snapshot, 100);
		await cache.get("a");
		await cache.set("c", snapshot, 100);

		expect(await cache.get("a")).toBe(snapshot);
		expect(await cache.get("b")).toBeUndefined();
		now += 101;
		expect(await cache.get("a")).toBeUndefined();
	});
});

describe("Redis entitlement cache", () => {
	it("serializes snapshots and removes corrupt values", async () => {
		const values = new Map<string, string>();
		const commands = {
			get: vi.fn(async (key: string) => values.get(key)),
			set: vi.fn(async (key: string, value: string) => {
				values.set(key, value);
			}),
			delete: vi.fn(async (key: string) => {
				values.delete(key);
			}),
		};
		const cache = createRedisEntitlementsCache(commands);
		const snapshot = makeSnapshot();

		await cache.set("valid", snapshot, 300_000);
		expect(await cache.get("valid")).toEqual(snapshot);

		values.set("invalid", "{not-json");
		expect(await cache.get("invalid")).toBeUndefined();
		expect(commands.delete).toHaveBeenCalledWith("invalid");
	});
});

describe("LayeredEntitlementsCache", () => {
	it("hydrates memory from Redis and falls back when Redis fails", async () => {
		const snapshot = makeSnapshot();
		const memory = new MemoryEntitlementsCache();
		const redis = {
			get: vi.fn(async () => snapshot),
			set: vi.fn(async () => undefined),
			delete: vi.fn(async () => undefined),
		};
		const onError = vi.fn();
		const cache = new LayeredEntitlementsCache({ memory, redis, onError });

		expect(await cache.get("target")).toMatchObject({ source: "redis", snapshot });
		expect(await cache.get("target")).toMatchObject({ source: "memory", snapshot });
		expect(redis.get).toHaveBeenCalledTimes(1);

		redis.get.mockRejectedValueOnce(new Error("redis unavailable"));
		expect(await cache.get("another-target")).toBeUndefined();
		expect(onError).toHaveBeenCalledWith(expect.any(Error), "redis");
	});

	it("invalidates both layers", async () => {
		const snapshot = makeSnapshot();
		const memory = new MemoryEntitlementsCache();
		const redis = {
			get: vi.fn(async () => undefined),
			set: vi.fn(async () => undefined),
			delete: vi.fn(async () => undefined),
		};
		const cache = new LayeredEntitlementsCache({ memory, redis });

		await cache.set("target", snapshot);
		await cache.delete("target");

		expect(await memory.get("target")).toBeUndefined();
		expect(redis.delete).toHaveBeenCalledWith("target");
	});
});
