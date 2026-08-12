import { createEntitlementsSnapshot } from "../src/shared";
import { ChargebeeEntitlementsWebClient } from "../src/web";

describe("ChargebeeEntitlementsWebClient", () => {
	it("loads a relay snapshot and evaluates synchronously", async () => {
		const snapshot = createEntitlementsSnapshot(
			"customer",
			[{ featureId: "sso", value: "true", isEnabled: true }],
			60_000,
		);
		const fetchImplementation = vi.fn(async () => Response.json(snapshot));
		const client = new ChargebeeEntitlementsWebClient({
			relayUrl: "/api/entitlements",
			fetchImplementation,
		});

		await client.initialize();

		expect(client.getBooleanValue("sso", false)).toMatchObject({
			value: true,
		});
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
			"customer",
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

		expect(client.getBooleanValue("sso", false)).toMatchObject({
			value: false,
			reason: "STALE",
		});
		expect(onStale).toHaveBeenCalledTimes(1);
	});

	it("refreshes its snapshot on reset", async () => {
		const first = createEntitlementsSnapshot(
			"customer",
			[{ featureId: "sso", value: "false", isEnabled: true }],
			60_000,
		);
		const second = createEntitlementsSnapshot(
			"customer",
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
		expect(client.getBooleanValue("sso", true).value).toBe(false);
		await client.reset();
		expect(client.getBooleanValue("sso", false).value).toBe(true);
		expect(onConfigurationChanged).toHaveBeenCalledWith(["sso"]);
	});

	it("does not retain the previous subject's snapshot after a failed reset", async () => {
		const snapshot = createEntitlementsSnapshot(
			"customer",
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
		expect(client.getBooleanValue("sso", false)).toMatchObject({
			value: false,
			errorCode: "PROVIDER_NOT_READY",
		});
	});
});
