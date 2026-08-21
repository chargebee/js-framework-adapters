import {
	createEntitlementsSnapshot,
	Feature,
	setDefaultEntitlements,
} from "../src/shared";
import { ChargebeeEntitlementsWebClient } from "../src/web";

afterEach(() => {
	setDefaultEntitlements(undefined);
});

describe("ChargebeeEntitlementsWebClient", () => {
	it("loads a relay snapshot and evaluates synchronously", async () => {
		const snapshot = createEntitlementsSnapshot(
			[{ featureId: "sso", value: "true", isEnabled: true }],
			60_000,
		);
		const fetchImplementation = vi.fn(async () => Response.json(snapshot));
		const client = new ChargebeeEntitlementsWebClient({
			relayUrl: "/api/entitlements",
			fetchImplementation,
		});

		await client.initialize();

		expect(client.getValue("sso", false)).toMatchObject({ value: true });
		expect(fetchImplementation).toHaveBeenCalledWith(
			"/api/entitlements",
			expect.objectContaining({
				cache: "no-store",
				credentials: "same-origin",
			}),
		);
	});

	it("fails closed when the relay snapshot expires", async () => {
		const snapshot = createEntitlementsSnapshot(
			[{ featureId: "sso", value: "true", isEnabled: true }],
			500,
			Date.now() - 1_000,
		);
		const onStale = vi.fn();
		const client = new ChargebeeEntitlementsWebClient({
			relayUrl: "/api/entitlements",
			fetchImplementation: async () => Response.json(snapshot),
			onStale,
		});
		await client.initialize();

		expect(client.getValue("sso", false)).toMatchObject({
			value: false,
			reason: "STALE",
		});
		expect(onStale).toHaveBeenCalledTimes(1);
	});

	it("refreshes its snapshot on reset", async () => {
		const first = createEntitlementsSnapshot(
			[{ featureId: "sso", value: "false", isEnabled: true }],
			60_000,
		);
		const second = createEntitlementsSnapshot(
			[{ featureId: "sso", value: "true", isEnabled: true }],
			60_000,
		);
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(Response.json(first))
			.mockResolvedValueOnce(Response.json(second));
		const onConfigurationChanged = vi.fn();
		const client = new ChargebeeEntitlementsWebClient({
			relayUrl: "/api/entitlements",
			fetchImplementation,
			onConfigurationChanged,
		});

		await client.initialize();
		expect(client.getValue("sso", true).value).toBe(false);
		await client.reset();
		expect(client.getValue("sso", false).value).toBe(true);
		expect(onConfigurationChanged).toHaveBeenCalledWith(["sso"]);
	});

	it("does not retain the previous subject's snapshot after a failed reset", async () => {
		const snapshot = createEntitlementsSnapshot(
			[{ featureId: "sso", value: "true", isEnabled: true }],
			60_000,
		);
		const fetchImplementation = vi
			.fn()
			.mockResolvedValueOnce(Response.json(snapshot))
			.mockResolvedValueOnce(
				Response.json({ error: "Unauthorized" }, { status: 401 }),
			);
		const onError = vi.fn();
		const client = new ChargebeeEntitlementsWebClient({
			relayUrl: "/api/entitlements",
			fetchImplementation,
			onError,
		});

		await client.initialize();
		await expect(client.reset()).rejects.toThrow("HTTP 401");
		expect(onError).toHaveBeenCalledWith(expect.stringContaining("HTTP 401"));
		expect(client.getValue("sso", false)).toMatchObject({
			value: false,
			errorCode: "PROVIDER_NOT_READY",
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
		const client = new ChargebeeEntitlementsWebClient({
			relayUrl: "/api/entitlements",
			fetchImplementation: async () => Response.json(snapshot),
		});
		await client.initialize();

		// Bound client via webClient.feature()
		const ssoFeature = client.feature("sso", false);
		const seatsFeature = client.feature("seats", 0);

		expect(await ssoFeature.get()).toBe(true);
		expect(await seatsFeature.get()).toBe(10);

		// Global client via setDefaultEntitlements(webClient)
		setDefaultEntitlements(client);
		const standaloneFeature = new Feature("seats", 0);
		expect(await standaloneFeature.get()).toBe(10);
	});
});
