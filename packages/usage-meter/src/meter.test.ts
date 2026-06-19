import type Chargebee from "chargebee";
import { describe, expect, it, vi } from "vitest";
import { UsageMeter } from "./meter.js";
import type { PendingUsageEvent } from "./types.js";

interface FakeChargebee {
	chargebee: Chargebee;
	sent: PendingUsageEvent[];
}

function fakeChargebee(failNext?: () => unknown): FakeChargebee {
	const sent: PendingUsageEvent[] = [];
	const chargebee = {
		usageEvent: {
			batchIngest: vi.fn(
				async ({ events }: { events: PendingUsageEvent[] }) => {
					sent.push(...events);
					if (failNext) {
						const t = failNext;
						failNext = undefined as unknown as typeof failNext;
						return t();
					}
					return {};
				},
			),
		},
	} as unknown as Chargebee;
	return { chargebee, sent };
}

describe("UsageMeter constructor", () => {
	it("throws when chargebee client is missing", () => {
		expect(() => new UsageMeter({} as never)).toThrow(/chargebee/);
	});

	it("uses defaultOnError when no onError is supplied", () => {
		const { chargebee } = fakeChargebee();
		const meter = new UsageMeter({ chargebee, flushMode: "onCall" });
		expect(meter.pendingCount()).toBe(0);
	});
});

describe("UsageMeter.wrap", () => {
	it("throws if no adapter matches the supplied client", () => {
		const { chargebee } = fakeChargebee();
		const meter = new UsageMeter({ chargebee, flushMode: "onCall" });
		expect(() => meter.wrap({ unrelated: true })).toThrow(/no adapter matches/);
	});

	it("uses built-in adapters for known clients", () => {
		const { chargebee } = fakeChargebee();
		const meter = new UsageMeter({ chargebee, flushMode: "onCall" });
		const fakeOpenAI = { chat: { completions: { create: () => {} } } };
		const wrapped = meter.wrap(fakeOpenAI);
		expect(wrapped).not.toBe(fakeOpenAI);
	});

	it("allows registering a custom adapter that wins over built-ins", async () => {
		const { chargebee, sent } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_x",
			flushMode: "onCall",
		});
		const customCall = vi.fn();
		meter.registerAdapter({
			name: "custom",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!c && typeof (c as { call?: unknown }).call === "function",
			wrap: (client, ctx) => {
				return {
					call: async () => {
						customCall();
						ctx.record({ input: 7, output: 3 });
						return { ok: true };
					},
				};
			},
		});

		const client = meter.wrap({ call: async () => ({ ok: true }) });
		await client.call();
		await meter.flush();
		expect(customCall).toHaveBeenCalled();
		expect(sent[0].properties.input_tokens).toBe(7);
		expect(sent[0].properties.output_tokens).toBe(3);
	});
});

describe("UsageMeter context resolution", () => {
	it("throws on record() when no subscription is resolvable", async () => {
		const { chargebee } = fakeChargebee();
		const meter = new UsageMeter({ chargebee, flushMode: "onCall" });
		const onError = vi.fn();
		meter.registerAdapter({
			name: "thrower",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					try {
						ctx.record({ input: 1 });
					} catch (err) {
						onError(err);
					}
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });
		await client.call();
		expect(onError).toHaveBeenCalled();
		expect(String(onError.mock.calls[0][0])).toMatch(
			/no subscription resolved/,
		);
	});

	it("withSubscription overrides the default for nested calls", async () => {
		const { chargebee, sent } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_default",
			flushMode: "onCall",
		});
		meter.registerAdapter({
			name: "noop",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					ctx.record({ input: 1 });
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });
		await client.call();
		await meter.withSubscription("sub_override", () => client.call());
		await meter.flush();
		expect(sent[0].subscription_id).toBe("sub_default");
		expect(sent[1].subscription_id).toBe("sub_override");
	});

	it("withContext propagates across awaits (AsyncLocalStorage)", async () => {
		const { chargebee, sent } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_default",
			flushMode: "onCall",
		});
		meter.registerAdapter({
			name: "noop",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					await new Promise((r) => setTimeout(r, 5));
					ctx.record({ input: 1 });
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });

		await meter.withContext(
			{
				subscriptionId: "sub_ctx",
				properties: { feature: "x", request_id: "r1" },
			},
			async () => {
				await client.call();
			},
		);
		await meter.flush();

		expect(sent[0].subscription_id).toBe("sub_ctx");
		expect(sent[0].properties.feature).toBe("x");
		expect(sent[0].properties.request_id).toBe("r1");
	});

	it("merges defaultProperties + context + per-call properties (per-call wins)", async () => {
		const { chargebee, sent } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_x",
			defaultProperties: { env: "prod", feature: "from-default" },
			flushMode: "onCall",
		});
		meter.registerAdapter({
			name: "noop",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					ctx.record(
						{ input: 1 },
						{ properties: { feature: "from-per-call", custom: 42 } },
					);
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });
		await meter.withContext(
			{ properties: { feature: "from-ctx", from_ctx: "yes" } },
			() => client.call(),
		);
		await meter.flush();

		expect(sent[0].properties).toMatchObject({
			env: "prod",
			feature: "from-per-call",
			from_ctx: "yes",
			custom: 42,
		});
	});
});

describe("UsageMeter event shape", () => {
	it("maps canonical fields onto Chargebee property keys", async () => {
		const { chargebee, sent } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_x",
			flushMode: "onCall",
		});
		meter.registerAdapter({
			name: "noop",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					ctx.record({
						input: 10,
						output: 5,
						cache_read: 3,
						cache_write_5m: 2,
						reasoning: 7,
					});
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });
		await client.call();
		await meter.flush();

		expect(sent[0].properties).toMatchObject({
			input_tokens: 10,
			output_tokens: 5,
			cache_read_tokens: 3,
			cache_write_5m_tokens: 2,
			reasoning_tokens: 7,
		});
	});

	it("honors per-meter metricMapping overrides", async () => {
		const { chargebee, sent } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_x",
			metricMapping: { input: "prompt_tok", output: "completion_tok" },
			flushMode: "onCall",
		});
		meter.registerAdapter({
			name: "noop",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					ctx.record({ input: 4, output: 2 });
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });
		await client.call();
		await meter.flush();

		expect(sent[0].properties.prompt_tok).toBe(4);
		expect(sent[0].properties.completion_tok).toBe(2);
		expect(sent[0].properties.input_tokens).toBeUndefined();
	});

	it("usage_timestamp is in milliseconds (not seconds) — regression", async () => {
		const { chargebee, sent } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_x",
			flushMode: "onCall",
		});
		meter.registerAdapter({
			name: "noop",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					ctx.record({ input: 1 }, { usageTimestampMs: 1_700_000_000_000 });
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });
		await client.call();
		await meter.flush();
		expect(sent[0].usage_timestamp).toBe(1_700_000_000_000);
	});

	it("deduplication_id uses the per-call requestId verbatim", async () => {
		const { chargebee, sent } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_x",
			flushMode: "onCall",
		});
		meter.registerAdapter({
			name: "noop",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					ctx.record({ input: 1 }, { requestId: "req_custom_123" });
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });
		await client.call();
		await meter.flush();
		expect(sent[0].deduplication_id).toBe("req_custom_123");
	});

	it("omits zero/negative usage fields", async () => {
		const { chargebee, sent } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_x",
			flushMode: "onCall",
		});
		meter.registerAdapter({
			name: "noop",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					ctx.record({
						input: 5,
						output: 0,
						cache_read: -1 as unknown as number,
					});
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });
		await client.call();
		await meter.flush();
		expect(sent[0].properties.input_tokens).toBe(5);
		expect(sent[0].properties.output_tokens).toBeUndefined();
		expect(sent[0].properties.cache_read_tokens).toBeUndefined();
	});
});

describe("UsageMeter delegation methods", () => {
	it("getUsageSummary forwards to UsageSummaryClient", async () => {
		const list = [
			{
				usage_summary: {
					subscription_id: "sub_x",
					feature_id: "feat",
					aggregated_value: "100",
					aggregated_from: 1,
					aggregated_to: 2,
				},
			},
		];
		const chargebee = {
			usageEvent: { batchIngest: vi.fn(async () => ({})) },
			usageSummary: {
				retrieveUsageSummaryForSubscription: vi.fn(async () => ({
					list,
					next_offset: "tok",
				})),
			},
		} as unknown as Chargebee;
		const meter = new UsageMeter({ chargebee, flushMode: "onCall" });
		const page = await meter.getUsageSummary({
			subscriptionId: "sub_x",
			featureId: "feat",
		});
		expect(page.items).toHaveLength(1);
		expect(page.nextOffset).toBe("tok");
	});

	it("parseAlertWebhook delegates to the parser", () => {
		const { chargebee } = fakeChargebee();
		const meter = new UsageMeter({ chargebee, flushMode: "onCall" });
		const event = meter.parseAlertWebhook({
			id: "ev_1",
			event_type: "alert_status_changed",
			occurred_at: 1,
			content: {
				alert: { id: "a", metered_feature_id: "f" },
				alert_status: { alert_id: "a", alert_status: "in_alarm" },
			},
		});
		expect(event?.alertId).toBe("a");
		expect(meter.parseAlertWebhook({ event_type: "other" })).toBeNull();
	});

	it("handleAlertWebhook dispatches to the matching handler", async () => {
		const { chargebee } = fakeChargebee();
		const meter = new UsageMeter({ chargebee, flushMode: "onCall" });
		const onAlarmTriggered = vi.fn();
		const event = await meter.handleAlertWebhook(
			{
				id: "ev_1",
				event_type: "alert_status_changed",
				occurred_at: 1,
				content: {
					alert: { id: "a", metered_feature_id: "f" },
					alert_status: { alert_id: "a", alert_status: "in_alarm" },
				},
			},
			{ onAlarmTriggered },
		);
		expect(onAlarmTriggered).toHaveBeenCalledTimes(1);
		expect(event?.alertId).toBe("a");
	});

	it("handleAlertWebhook returns null for non-alert payloads", async () => {
		const { chargebee } = fakeChargebee();
		const meter = new UsageMeter({ chargebee, flushMode: "onCall" });
		const event = await meter.handleAlertWebhook(
			{ event_type: "subscription_created" },
			{ onAlarmTriggered: vi.fn() },
		);
		expect(event).toBeNull();
	});
});

describe("UsageMeter error paths", () => {
	it("falls back to returning the original client when adapter.wrap throws", () => {
		const { chargebee } = fakeChargebee();
		const onError = vi.fn();
		const meter = new UsageMeter({ chargebee, flushMode: "onCall", onError });
		const original = { call: () => {} };
		meter.registerAdapter({
			name: "broken",
			matches: (c): c is { call: () => void } =>
				!!(c as { call?: unknown }).call,
			wrap: () => {
				throw new Error("wrap failed");
			},
		});
		const wrapped = meter.wrap(original);
		expect(wrapped).toBe(original);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0][1]).toBe("wrap");
	});

	it("shutdown drops events permanently when Chargebee returns a 4xx validation code", async () => {
		const onError = vi.fn();
		const chargebee = {
			usageEvent: {
				batchIngest: vi.fn(async () => {
					throw {
						message: "validation failed",
						http_status_code: 400,
						api_error_code: "UBB_BATCH_INGESTION_VALIDATION_ERROR",
					};
				}),
			},
		} as unknown as Chargebee;
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_x",
			flushMode: "background",
			flushIntervalMs: 60_000,
			onError,
		});
		meter.registerAdapter({
			name: "noop",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					ctx.record({ input: 1 });
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });
		await client.call();
		await meter.shutdown();
		expect(onError).toHaveBeenCalled();
		expect(meter.pendingCount()).toBe(0);
	});
});

describe("UsageMeter flush lifecycle", () => {
	it("onCall mode flushes after every record (no buffering)", async () => {
		const { chargebee } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_x",
			flushMode: "onCall",
		});
		meter.registerAdapter({
			name: "noop",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					ctx.record({ input: 1 });
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });
		await client.call();
		await meter.flush();
		expect(meter.pendingCount()).toBe(0);
		await meter.shutdown();
	});

	it("shutdown drains buffered events", async () => {
		const { chargebee, sent } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_x",
			flushMode: "background",
			flushIntervalMs: 60_000,
		});
		meter.registerAdapter({
			name: "noop",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					ctx.record({ input: 1 });
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });
		await client.call();
		await client.call();
		await client.call();
		expect(meter.pendingCount()).toBe(3);
		await meter.shutdown();
		expect(sent).toHaveLength(3);
	});

	it("flushing twice concurrently de-duplicates the in-flight send", async () => {
		const { chargebee, sent } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_x",
			flushMode: "background",
			flushIntervalMs: 60_000,
		});
		meter.registerAdapter({
			name: "noop",
			matches: (c): c is { call: () => Promise<unknown> } =>
				!!(c as { call?: unknown }).call,
			wrap: (_client, ctx) => ({
				call: async () => {
					ctx.record({ input: 1 });
					return {};
				},
			}),
		});
		const client = meter.wrap({ call: async () => ({}) });
		await client.call();
		await client.call();
		await Promise.all([meter.flush(), meter.flush(), meter.flush()]);
		expect(sent).toHaveLength(2);
		await meter.shutdown();
	});

	it("LLM call errors do not trigger any record/flush attempts", async () => {
		const { chargebee, sent } = fakeChargebee();
		const meter = new UsageMeter({
			chargebee,
			defaultSubscriptionId: "sub_x",
			flushMode: "onCall",
		});
		const fakeOpenAI = {
			chat: {
				completions: {
					create: async () => {
						throw new Error("provider boom");
					},
				},
			},
		};
		const wrapped = meter.wrap(fakeOpenAI);
		await expect(
			(wrapped as typeof fakeOpenAI).chat.completions.create(),
		).rejects.toThrow("provider boom");
		await meter.flush();
		expect(sent).toHaveLength(0);
		await meter.shutdown();
	});
});
