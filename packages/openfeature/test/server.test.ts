import {
	type EvaluationContext,
	OpenFeature,
} from "@openfeature/server-sdk";
import type { CustomerEntitlement } from "chargebee";
import {
	createMemoryEntitlementsCache,
	type EntitlementsStorage,
} from "../src/cache";
import {
	type ChargebeeEntitlementsClient,
	ChargebeeEntitlementsProvider,
	createEntitlementsRelayHandler,
} from "../src/server";
import type { ChargebeeEntitlementsSnapshot } from "../src/shared";

function makeClient(
	customerPages: Array<{
		list: Array<{ customer_entitlement: CustomerEntitlement }>;
		next_offset?: string;
	}>,
) {
	const customerRequest = vi.fn(async (_id: string, input?: { offset?: string }) => {
		const index = input?.offset ? Number(input.offset) : 0;
		return customerPages[index] ?? { list: [] };
	});
	const subscriptionRequest = vi.fn(async () => ({ list: [] }));
	const client = {
		customerEntitlement: {
			entitlementsForCustomer: customerRequest,
		},
		subscriptionEntitlement: {
			subscriptionEntitlementsForSubscription: subscriptionRequest,
		},
	} as unknown as ChargebeeEntitlementsClient;
	return { client, customerRequest, subscriptionRequest };
}

const context: EvaluationContext = {
	targetingKey: "app-user-1",
	chargebeeCustomerId: "customer-1",
};

/** A durable store keeps snapshots past `expiresAt`; the provider refreshes them. */
function makeDurableStore(): EntitlementsStorage {
	const snapshots = new Map<string, ChargebeeEntitlementsSnapshot>();
	return {
		get: async (key) => snapshots.get(key),
		set: async (key, snapshot) => {
			snapshots.set(key, snapshot);
		},
		delete: async (key) => {
			snapshots.delete(key);
		},
	};
}

const ssoPage = {
	list: [
		{
			customer_entitlement: {
				customer_id: "customer-1",
				feature_id: "sso",
				value: "true",
				is_enabled: true,
			},
		},
	],
};

afterEach(async () => {
	await OpenFeature.clearProviders();
});

describe("ChargebeeEntitlementsProvider", () => {
	it("loads all customer entitlements once and reuses the target snapshot", async () => {
		const { client, customerRequest } = makeClient([
			{
				list: [
					{
						customer_entitlement: {
							customer_id: "customer-1",
							feature_id: "sso",
							value: "true",
							is_enabled: true,
						},
					},
				],
				next_offset: "1",
			},
			{
				list: [
					{
						customer_entitlement: {
							customer_id: "customer-1",
							feature_id: "seats",
							value: "10",
							is_enabled: true,
						},
					},
				],
			},
		]);
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: client,
			cache: createMemoryEntitlementsCache(),
			cacheTtlMs: 60_000,
		});

		const first = await provider.resolveBooleanEvaluation(
			"sso",
			false,
			context,
			console,
		);
		const second = await provider.resolveNumberEvaluation(
			"seats",
			0,
			context,
			console,
		);

		expect(first).toMatchObject({ value: true, reason: "TARGETING_MATCH" });
		expect(second).toMatchObject({ value: 10, reason: "CACHED" });
		expect(customerRequest).toHaveBeenCalledTimes(2);
		expect(customerRequest).toHaveBeenLastCalledWith(
			"customer-1",
			expect.objectContaining({ offset: "1", limit: 100 }),
		);
	});

	it("deduplicates concurrent cache misses", async () => {
		let release: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const customerRequest = vi.fn(async () => {
			await pending;
			return {
				list: [
					{
						customer_entitlement: {
							customer_id: "customer-1",
							feature_id: "sso",
							value: "true",
							is_enabled: true,
						},
					},
				],
			};
		});
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: {
				customerEntitlement: {
					entitlementsForCustomer: customerRequest,
				},
				subscriptionEntitlement: {
					subscriptionEntitlementsForSubscription: vi.fn(),
				},
			} as unknown as ChargebeeEntitlementsClient,
		});

		const first = provider.getSnapshot(context);
		const second = provider.getSnapshot(context);
		release?.();

		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
		expect(customerRequest).toHaveBeenCalledTimes(1);
	});

	it("does not repopulate the cache with a request invalidated in flight", async () => {
		let release: (() => void) | undefined;
		let markStarted: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const customerRequest = vi.fn(async () => {
			markStarted?.();
			await pending;
			return { list: [] };
		});
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: {
				customerEntitlement: {
					entitlementsForCustomer: customerRequest,
				},
				subscriptionEntitlement: {
					subscriptionEntitlementsForSubscription: vi.fn(),
				},
			} as unknown as ChargebeeEntitlementsClient,
		});

		const first = provider.getSnapshot(context);
		await started;
		await provider.deleteSnapshot({ mode: "customer", customerId: "customer-1" });
		release?.();
		await first;
		await provider.getSnapshot(context);

		expect(customerRequest).toHaveBeenCalledTimes(2);
	});

	it("returns INVALID_CONTEXT without calling Chargebee", async () => {
		const { client, customerRequest } = makeClient([]);
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: client,
		});

		await expect(
			provider.resolveBooleanEvaluation(
				"sso",
				false,
				{ targetingKey: "app-user-1" },
				console,
			),
		).resolves.toMatchObject({
			value: false,
			errorCode: "INVALID_CONTEXT",
		});
		expect(customerRequest).not.toHaveBeenCalled();
	});

	it("loads subscription-scoped entitlements", async () => {
		const subscriptionRequest = vi.fn(async () => ({
			list: [
				{
					subscription_entitlement: {
						subscription_id: "subscription-1",
						feature_id: "seats",
						feature_name: "Licensed seats",
						feature_unit: "seat",
						feature_type: "quantity",
						value: "50",
						is_overridden: true,
						is_enabled: true,
					},
				},
			],
		}));
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: {
				customerEntitlement: {
					entitlementsForCustomer: vi.fn(),
				},
				subscriptionEntitlement: {
					subscriptionEntitlementsForSubscription: subscriptionRequest,
				},
			} as unknown as ChargebeeEntitlementsClient,
		});

		await expect(
			provider.resolveNumberEvaluation(
				"seats",
				0,
				{
					chargebeeEvaluationMode: "subscription",
					chargebeeSubscriptionId: "subscription-1",
				},
				console,
			),
		).resolves.toMatchObject({
			value: 50,
			flagMetadata: {
				chargebeeFeatureType: "quantity",
				chargebeeOverridden: true,
			},
		});
		expect(subscriptionRequest).toHaveBeenCalledWith(
			"subscription-1",
			expect.objectContaining({ limit: 100 }),
		);
	});

	it("reads the cache first, then the store, and hydrates the cache", async () => {
		const { client, customerRequest } = makeClient([ssoPage]);
		const cache = createMemoryEntitlementsCache();
		const store = createMemoryEntitlementsCache();
		await new ChargebeeEntitlementsProvider({
			chargebeeClient: client,
			store,
		}).refreshSnapshot({ mode: "customer", customerId: "customer-1" });

		const reader = new ChargebeeEntitlementsProvider({
			chargebeeClient: client,
			cache,
			store,
			refreshOnMiss: "background",
		});

		await expect(reader.getSnapshot(context)).resolves.toMatchObject({
			source: "store",
		});
		await expect(reader.getSnapshot(context)).resolves.toMatchObject({
			source: "cache",
		});
		expect(customerRequest).toHaveBeenCalledTimes(1);
	});

	it("falls back to the store when the cache is unavailable", async () => {
		const { client } = makeClient([ssoPage]);
		const store = createMemoryEntitlementsCache();
		const onError = vi.fn();
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: client,
			cache: {
				get: vi.fn(async () => {
					throw new Error("redis unavailable");
				}),
				set: vi.fn(async () => undefined),
				delete: vi.fn(async () => undefined),
			},
			store,
			onError,
		});
		await provider.refreshSnapshot({
			mode: "customer",
			customerId: "customer-1",
		});

		await expect(
			provider.resolveBooleanEvaluation("sso", false, context, console),
		).resolves.toMatchObject({
			value: true,
			reason: "CACHED",
			flagMetadata: { cacheSource: "store" },
		});
		expect(onError).toHaveBeenCalledWith(expect.any(Error), {
			operation: "cache-read",
			target: { mode: "customer", customerId: "customer-1" },
		});
	});

	it("evicts the cached snapshot before priming a new one", async () => {
		const { client } = makeClient([ssoPage, ssoPage]);
		const store = makeDurableStore();
		const cache = createMemoryEntitlementsCache();
		const evict = vi.spyOn(cache, "delete");
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: client,
			cache,
			store,
		});
		const target = { mode: "customer", customerId: "customer-1" } as const;

		await provider.refreshSnapshot(target);
		await provider.getSnapshot(context);
		await provider.refreshSnapshot(target);

		expect(evict).toHaveBeenCalledTimes(2);
		expect(evict).toHaveBeenCalledWith(
			"chargebee:openfeature:v1:customer:customer-1:consolidated",
		);
	});

	it("does not join a request refresh that was already in flight", async () => {
		let releaseFirst: (() => void) | undefined;
		let finishFirst: (() => void) | undefined;
		const firstPending = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const firstFinished = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		let requestCount = 0;
		const customerRequest = vi.fn(async () => {
			const requestNumber = ++requestCount;
			if (requestNumber === 1) {
				await firstPending;
				finishFirst?.();
				return ssoPage;
			}
			return {
				list: [
					{
						customer_entitlement: {
							customer_id: "customer-1",
							feature_id: "sso",
							value: "false",
							is_enabled: true,
						},
					},
				],
			};
		});
		const onSnapshotRefreshed = vi.fn();
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: {
				customerEntitlement: { entitlementsForCustomer: customerRequest },
				subscriptionEntitlement: {
					subscriptionEntitlementsForSubscription: vi.fn(),
				},
			} as unknown as ChargebeeEntitlementsClient,
			cache: createMemoryEntitlementsCache(),
			store: makeDurableStore(),
			refreshOnMiss: "background",
			onSnapshotRefreshed,
		});
		const target = { mode: "customer", customerId: "customer-1" } as const;

		await expect(
			provider.resolveBooleanEvaluation("sso", false, context, console),
		).resolves.toMatchObject({ reason: "STALE" });
		await vi.waitFor(() => expect(customerRequest).toHaveBeenCalledTimes(1));

		const explicitRefresh = provider.refreshSnapshot(target);
		await vi.waitFor(() => expect(customerRequest).toHaveBeenCalledTimes(2));
		await expect(explicitRefresh).resolves.toMatchObject({
			snapshot: {
				entitlements: { sso: expect.objectContaining({ value: "false" }) },
			},
		});

		releaseFirst?.();
		await firstFinished;
		expect(onSnapshotRefreshed).toHaveBeenCalledTimes(1);
		expect(onSnapshotRefreshed).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: "explicit" }),
		);
		await expect(provider.getSnapshot(context)).resolves.toMatchObject({
			snapshot: {
				entitlements: { sso: expect.objectContaining({ value: "false" }) },
			},
		});
	});

	it("reports a pending snapshot and refreshes in the background", async () => {
		const { client, customerRequest } = makeClient([ssoPage]);
		const onSnapshotRefreshed = vi.fn();
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: client,
			store: createMemoryEntitlementsCache(),
			refreshOnMiss: "background",
			onSnapshotRefreshed,
		});

		await expect(
			provider.resolveBooleanEvaluation("sso", false, context, console),
		).resolves.toEqual({
			value: false,
			reason: "STALE",
			flagMetadata: { snapshotPending: true },
		});

		await vi.waitFor(() =>
			expect(onSnapshotRefreshed).toHaveBeenCalledWith(
				expect.objectContaining({ trigger: "request" }),
			),
		);
		await expect(
			provider.resolveBooleanEvaluation("sso", false, context, console),
		).resolves.toMatchObject({ value: true, reason: "CACHED" });
		expect(customerRequest).toHaveBeenCalledTimes(1);
	});

	it("serves an expired stored snapshot while refreshing it", async () => {
		const { client, customerRequest } = makeClient([ssoPage]);
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: client,
			store: makeDurableStore(),
			snapshotTtlMs: 1,
			refreshOnMiss: "background",
		});
		await provider.refreshSnapshot({
			mode: "customer",
			customerId: "customer-1",
		});
		await new Promise((resolve) => setTimeout(resolve, 5));

		await expect(provider.getSnapshot(context)).resolves.toMatchObject({
			source: "store",
		});
		await vi.waitFor(() => expect(customerRequest).toHaveBeenCalledTimes(2));
	});

	it("backs off after a failed background refresh", async () => {
		const customerRequest = vi.fn(async () => {
			throw new Error("chargebee unavailable");
		});
		const onError = vi.fn();
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: {
				customerEntitlement: { entitlementsForCustomer: customerRequest },
				subscriptionEntitlement: {
					subscriptionEntitlementsForSubscription: vi.fn(),
				},
			} as unknown as ChargebeeEntitlementsClient,
			refreshOnMiss: "background",
			refreshBackoffMs: 60_000,
			onError,
		});

		await provider.resolveBooleanEvaluation("sso", false, context, console);
		await vi.waitFor(() =>
			expect(onError).toHaveBeenCalledWith(
				expect.any(Error),
				expect.objectContaining({ operation: "refresh" }),
			),
		);
		await provider.resolveBooleanEvaluation("sso", false, context, console);

		expect(customerRequest).toHaveBeenCalledTimes(1);
	});

	it("works through the OpenFeature server SDK", async () => {
		const { client } = makeClient([
			{
				list: [
					{
						customer_entitlement: {
							customer_id: "customer-1",
							feature_id: "sso",
							value: "true",
							is_enabled: true,
						},
					},
				],
			},
		]);
		await OpenFeature.setProviderAndWait(
			new ChargebeeEntitlementsProvider({ chargebeeClient: client }),
		);

		await expect(
			OpenFeature.getClient().getBooleanValue("sso", false, context),
		).resolves.toBe(true);
	});
});

describe("entitlement relay", () => {
	it("derives identity on the server and rejects spoofed IDs", async () => {
		const { client } = makeClient([{ list: [] }]);
		const provider = new ChargebeeEntitlementsProvider({
			chargebeeClient: client,
		});
		const resolveContext = vi.fn(async () => context);
		const handler = createEntitlementsRelayHandler({
			provider,
			resolveContext,
		});

		const spoofed = await handler(
			new Request(
				"https://example.com/api/entitlements?chargebeeCustomerId=other",
			),
		);
		expect(spoofed.status).toBe(400);
		expect(resolveContext).not.toHaveBeenCalled();

		const response = await handler(
			new Request("https://example.com/api/entitlements", {
				headers: { cookie: "session=valid" },
			}),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("no-store");
		const body = await response.json();
		expect(body).not.toHaveProperty("customerId");
		expect(JSON.stringify(body)).not.toContain("customer-1");
	});

	it("returns 401 when the application session has no identity", async () => {
		const { client } = makeClient([]);
		const handler = createEntitlementsRelayHandler({
			provider: new ChargebeeEntitlementsProvider({
				chargebeeClient: client,
			}),
			resolveContext: async () => null,
		});

		const response = await handler(
			new Request("https://example.com/api/entitlements"),
		);
		expect(response.status).toBe(401);
	});

	it("rejects methods other than GET", async () => {
		const { client } = makeClient([]);
		const resolveContext = vi.fn(async () => context);
		const handler = createEntitlementsRelayHandler({
			provider: new ChargebeeEntitlementsProvider({
				chargebeeClient: client,
			}),
			resolveContext,
		});

		const response = await handler(
			new Request("https://example.com/api/entitlements", { method: "POST" }),
		);
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET");
		expect(resolveContext).not.toHaveBeenCalled();
	});
});
