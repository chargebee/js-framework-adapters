import {
	createMemoryEntitlementsCache,
	createRedisEntitlementsCache,
	type RedisEntitlementsCacheClient,
} from "../src/cache";
import { createEntitlementsSnapshot } from "../src/shared";

/** A minimal stand-in for the ioredis methods `createRedisEntitlementsCache` uses. */
function makeRedisClient(values = new Map<string, string>()) {
	const mocks = {
		get: vi.fn(async (key: string) => values.get(key) ?? null),
		set: vi.fn(async (key: string, value: string) => {
			values.set(key, value);
			return "OK" as const;
		}),
		del: vi.fn(async (key: string) => (values.delete(key) ? 1 : 0)),
	};
	return { client: mocks as unknown as RedisEntitlementsCacheClient, mocks };
}

function makeSnapshot(ttlMs = 60_000) {
	return createEntitlementsSnapshot(
		[{ featureId: "sso", value: "true", isEnabled: true }],
		ttlMs,
	);
}

describe("memory entitlement cache", () => {
	it("expires entries and evicts the least recently used entry", async () => {
		let now = 1_000;
		const cache = createMemoryEntitlementsCache({
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

	it("applies the configured TTL when the caller does not pass one", async () => {
		let now = 1_000;
		const cache = createMemoryEntitlementsCache({ ttlMs: 500, now: () => now });

		await cache.set("a", makeSnapshot());

		now += 499;
		expect(await cache.get("a")).toBeDefined();
		now += 2;
		expect(await cache.get("a")).toBeUndefined();
	});
});

describe("Redis entitlement cache", () => {
	it("serializes snapshots and removes corrupt values", async () => {
		const values = new Map<string, string>();
		const { client, mocks } = makeRedisClient(values);
		const cache = createRedisEntitlementsCache(client);
		const snapshot = makeSnapshot();

		await cache.set("valid", snapshot, 300_000);
		expect(await cache.get("valid")).toEqual(snapshot);

		values.set("invalid", "{not-json");
		expect(await cache.get("invalid")).toBeUndefined();
		expect(mocks.del).toHaveBeenCalledWith("invalid");
	});

	it("applies the configured TTL when the caller does not pass one", async () => {
		const { client, mocks } = makeRedisClient();
		const cache = createRedisEntitlementsCache(client, { ttlMs: 45_000 });
		const snapshot = makeSnapshot();

		await cache.set("default-ttl", snapshot);
		await cache.set("explicit-ttl", snapshot, 1_000);

		expect(mocks.set).toHaveBeenNthCalledWith(
			1,
			"default-ttl",
			expect.any(String),
			"PX",
			45_000,
		);
		expect(mocks.set).toHaveBeenNthCalledWith(
			2,
			"explicit-ttl",
			expect.any(String),
			"PX",
			1_000,
		);
	});

	it("leaves snapshot freshness to the provider", async () => {
		const { client } = makeRedisClient();
		const cache = createRedisEntitlementsCache(client);
		const expired = makeSnapshot(-1_000);

		await cache.set("expired", expired, 1_000);

		expect(await cache.get("expired")).toEqual(expired);
	});
});
