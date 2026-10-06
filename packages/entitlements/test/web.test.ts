import {
	createEntitlementsSnapshot,
	Feature,
	setDefaultEntitlements,
} from "../src/shared";
import { ChargebeeEntitlements } from "../src/web";

afterEach(() => {
	setDefaultEntitlements(undefined);
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const snapshotWith = (sso: string) =>
	createEntitlementsSnapshot(
		[{ featureId: "sso", value: sso, isEnabled: true }],
		60_000,
	);

describe("ChargebeeEntitlements (web)", () => {
	it("loads a relay snapshot and evaluates synchronously", async () => {
		const fetchImplementation = vi.fn(async () =>
			Response.json(snapshotWith("true")),
		);
		const client = new ChargebeeEntitlements({
			relayUrl: "/api/entitlements",
			fetchImplementation,
		});

		await client.initialize();

		expect(client.get("sso", false)).toBe(true);
		expect(client.getDetails("sso", false)).toMatchObject({
			value: true,
			status: "granted",
			source: "relay",
		});
		expect(fetchImplementation).toHaveBeenCalledWith(
			"/api/entitlements",
			expect.objectContaining({
				cache: "no-store",
				credentials: "same-origin",
			}),
		);
	});

	it("reports pending before the snapshot loads", () => {
		const client = new ChargebeeEntitlements({
			relayUrl: "/api/entitlements",
			fetchImplementation: async () => Response.json(snapshotWith("true")),
		});

		expect(client.getDetails("sso", false)).toEqual({
			value: false,
			status: "pending",
		});
	});

	it("fails closed when the relay snapshot expires", async () => {
		const snapshot = createEntitlementsSnapshot(
			[{ featureId: "sso", value: "true", isEnabled: true }],
			500,
			Date.now() - 1_000,
		);
		const onSnapshotExpired = vi.fn();
		const client = new ChargebeeEntitlements({
			relayUrl: "/api/entitlements",
			fetchImplementation: async () => Response.json(snapshot),
			onSnapshotExpired,
		});
		await client.initialize();

		expect(client.getDetails("sso", false)).toMatchObject({
			value: false,
			status: "stale",
		});
		expect(onSnapshotExpired).toHaveBeenCalledTimes(1);
	});

	it("reports expiry once while the relay keeps serving an expired snapshot", async () => {
		const snapshot = createEntitlementsSnapshot(
			[{ featureId: "sso", value: "true", isEnabled: true }],
			500,
			Date.now() - 1_000,
		);
		const fetchImplementation = vi.fn(async () => Response.json(snapshot));
		const onSnapshotExpired = vi.fn();
		const client = new ChargebeeEntitlements({
			relayUrl: "/api/entitlements",
			fetchImplementation,
			onSnapshotExpired,
		});
		await client.initialize();

		client.get("sso", false);
		await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(2));
		await new Promise((resolve) => setTimeout(resolve, 0));
		client.get("sso", false);

		expect(onSnapshotExpired).toHaveBeenCalledTimes(1);
	});

	it("discards a relay response that lands after close", async () => {
		const pending = deferred<Response>();
		const client = new ChargebeeEntitlements({
			relayUrl: "/api/entitlements",
			fetchImplementation: () => pending.promise,
		});

		const loading = client.initialize();
		await client.close();
		pending.resolve(Response.json(snapshotWith("true")));
		await loading;

		expect(client.getDetails("sso", false)).toMatchObject({
			status: "pending",
		});
	});

	it("keeps the new subject's snapshot when an old response lands after reset", async () => {
		const pending = deferred<Response>();
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(Response.json(snapshotWith("false")))
			.mockReturnValueOnce(pending.promise)
			.mockResolvedValueOnce(Response.json(snapshotWith("true")));
		const client = new ChargebeeEntitlements({
			relayUrl: "/api/entitlements",
			fetchImplementation,
		});
		await client.initialize();

		const oldRefresh = client.refreshSnapshot();
		await client.reset();
		pending.resolve(Response.json(snapshotWith("false")));
		await oldRefresh;

		expect(client.get("sso", false)).toBe(true);
	});

	it("refreshes its snapshot on reset", async () => {
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(Response.json(snapshotWith("false")))
			.mockResolvedValueOnce(Response.json(snapshotWith("true")));
		const onSnapshotRefreshed = vi.fn();
		const client = new ChargebeeEntitlements({
			relayUrl: "/api/entitlements",
			fetchImplementation,
			onSnapshotRefreshed,
		});

		await client.initialize();
		expect(client.get("sso", true)).toBe(false);
		expect(onSnapshotRefreshed).not.toHaveBeenCalled();

		await client.reset();
		expect(client.get("sso", false)).toBe(true);
		expect(onSnapshotRefreshed).toHaveBeenCalledWith(
			expect.objectContaining({ changedFeatureIds: ["sso"] }),
		);
	});

	it("does not retain the previous subject's snapshot after a failed reset", async () => {
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(Response.json(snapshotWith("true")))
			.mockResolvedValueOnce(
				Response.json({ error: "Unauthorized" }, { status: 401 }),
			);
		const onError = vi.fn();
		const client = new ChargebeeEntitlements({
			relayUrl: "/api/entitlements",
			fetchImplementation,
			onError,
		});

		await client.initialize();
		await expect(client.reset()).rejects.toThrow("HTTP 401");
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("HTTP 401") }),
			{ operation: "refresh" },
		);
		expect(client.getDetails("sso", false)).toMatchObject({
			value: false,
			status: "pending",
		});
	});

	it("evaluates Feature instances without requiring a target", async () => {
		const snapshot = createEntitlementsSnapshot(
			[
				{ featureId: "sso", value: "true", isEnabled: true },
				{ featureId: "seats", value: "10", isEnabled: true },
			],
			60_000,
		);
		const client = new ChargebeeEntitlements({
			relayUrl: "/api/entitlements",
			fetchImplementation: async () => Response.json(snapshot),
		});
		await client.initialize();

		// Bound client via client.feature()
		const ssoFeature = client.feature("sso", false);
		const seatsFeature = client.feature("seats", 0);

		expect(await ssoFeature.get()).toBe(true);
		expect(await seatsFeature.get()).toBe(10);
		// @ts-expect-error A web feature takes no target.
		expect(await seatsFeature.get({ customerId: "customer-1" })).toBe(10);

		// Global client via setDefaultEntitlements(client)
		setDefaultEntitlements(client);
		const standaloneFeature = new Feature("seats", 0);
		expect(await standaloneFeature.get()).toBe(10);
	});
});
