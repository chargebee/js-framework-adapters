import { OpenFeature } from "@openfeature/web-sdk";
import { createEntitlementsSnapshot } from "../src/shared";
import { ChargebeeEntitlementsWebProvider } from "../src/web";

afterEach(async () => {
	await OpenFeature.clearProviders();
});

describe("ChargebeeEntitlementsWebProvider", () => {
	it("loads a relay snapshot and evaluates synchronously through the web SDK", async () => {
		const snapshot = createEntitlementsSnapshot(
			"customer",
			[{ featureId: "sso", value: "true", isEnabled: true }],
			60_000,
		);
		const fetchImplementation = vi.fn(async () => Response.json(snapshot));
		const provider = new ChargebeeEntitlementsWebProvider({
			relayUrl: "/api/entitlements",
			fetchImplementation,
		});

		await OpenFeature.setProviderAndWait(provider);

		expect(OpenFeature.getClient().getBooleanValue("sso", false)).toBe(true);
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
		const provider = new ChargebeeEntitlementsWebProvider({
			relayUrl: "/api/entitlements",
			fetchImplementation: async () => Response.json(snapshot),
		});
		await provider.initialize();

		expect(
			provider.resolveBooleanEvaluation("sso", false, {}, console),
		).toMatchObject({
			value: false,
			reason: "STALE",
		});
	});

	it("refreshes its snapshot when context changes", async () => {
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
		const provider = new ChargebeeEntitlementsWebProvider({
			relayUrl: "/api/entitlements",
			fetchImplementation,
		});

		await provider.initialize();
		expect(
			provider.resolveBooleanEvaluation("sso", true, {}, console).value,
		).toBe(false);
		await provider.onContextChange({}, { targetingKey: "new-user" });
		expect(
			provider.resolveBooleanEvaluation("sso", false, {}, console).value,
		).toBe(true);
	});

	it("does not retain the previous subject's snapshot after a failed context change", async () => {
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
		const provider = new ChargebeeEntitlementsWebProvider({
			relayUrl: "/api/entitlements",
			fetchImplementation,
		});

		await provider.initialize();
		await expect(
			provider.onContextChange(
				{ targetingKey: "first-user" },
				{ targetingKey: "second-user" },
			),
		).rejects.toThrow("HTTP 401");
		expect(
			provider.resolveBooleanEvaluation("sso", false, {}, console),
		).toMatchObject({
			value: false,
			errorCode: "PROVIDER_NOT_READY",
		});
	});
});
