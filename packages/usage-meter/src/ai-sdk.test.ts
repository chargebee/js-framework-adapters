import { describe, expect, it, vi } from "vitest";
import { chargebeeMeterMiddleware } from "./ai-sdk.js";
import type { UsageMeter } from "./meter.js";
import type { CallContext, CanonicalUsage } from "./types.js";

interface FakeMeter {
	meter: UsageMeter;
	records: Array<{
		usage: Partial<CanonicalUsage>;
		ctx: CallContext | undefined;
	}>;
}

function fakeMeter(opts: { throwOnRecord?: boolean } = {}): FakeMeter {
	const records: FakeMeter["records"] = [];
	const meter = {
		__record: vi.fn((usage: Partial<CanonicalUsage>, ctx?: CallContext) => {
			if (opts.throwOnRecord) throw new Error("meter blew up");
			records.push({ usage, ctx });
		}),
	} as unknown as UsageMeter;
	return { meter, records };
}

function streamOf<T>(chunks: T[]): ReadableStream<T> {
	return new ReadableStream<T>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
}

async function drain<T>(stream: ReadableStream<T>): Promise<T[]> {
	const reader = stream.getReader();
	const out: T[] = [];
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			out.push(value as T);
		}
	} finally {
		reader.releaseLock();
	}
	return out;
}

describe("chargebeeMeterMiddleware.wrapGenerate", () => {
	it("records canonical usage from the AI SDK v5 shape", async () => {
		const { meter, records } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter);
		const result = await mw.wrapGenerate?.({
			doGenerate: async () => ({
				text: "hi",
				usage: {
					inputTokens: 11,
					outputTokens: 7,
					cachedInputTokens: 3,
					reasoningTokens: 4,
				},
			}),
		});
		expect(records).toHaveLength(1);
		expect(records[0].usage).toEqual({
			input: 11,
			output: 7,
			cache_read: 3,
			reasoning: 4,
		});
		expect((result as { text: string }).text).toBe("hi");
	});

	it("records canonical usage from the AI SDK v4 shape (promptTokens / completionTokens)", async () => {
		const { meter, records } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter);
		await mw.wrapGenerate?.({
			doGenerate: async () => ({
				usage: {
					promptTokens: 22,
					completionTokens: 13,
					cachedPromptTokens: 5,
				},
			}),
		});
		expect(records[0].usage).toEqual({
			input: 22,
			output: 13,
			cache_read: 5,
		});
	});

	it("forwards the configured context to __record", async () => {
		const { meter, records } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter, {
			context: { subscriptionId: "sub_x", properties: { feature: "demo" } },
		});
		await mw.wrapGenerate?.({
			doGenerate: async () => ({ usage: { inputTokens: 1, outputTokens: 1 } }),
		});
		expect(records[0].ctx).toEqual({
			subscriptionId: "sub_x",
			properties: { feature: "demo" },
		});
	});

	it("does NOT record when usage is missing", async () => {
		const { meter, records } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter);
		const result = await mw.wrapGenerate?.({
			doGenerate: async () => ({ text: "hi" }),
		});
		expect(records).toHaveLength(0);
		expect((result as { text: string }).text).toBe("hi");
	});

	it("does NOT record when result is not an object", async () => {
		const { meter, records } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter);
		await mw.wrapGenerate?.({
			doGenerate: async () => null,
		});
		expect(records).toHaveLength(0);
	});

	it("does NOT record when every usage field is zero", async () => {
		const { meter, records } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter);
		await mw.wrapGenerate?.({
			doGenerate: async () => ({
				usage: { inputTokens: 0, outputTokens: 0 },
			}),
		});
		expect(records).toHaveLength(0);
	});

	it("swallows meter errors silently (trust contract)", async () => {
		const { meter } = fakeMeter({ throwOnRecord: true });
		const mw = chargebeeMeterMiddleware(meter);
		const result = await mw.wrapGenerate?.({
			doGenerate: async () => ({
				text: "hi",
				usage: { inputTokens: 1, outputTokens: 1 },
			}),
		});
		expect((result as { text: string }).text).toBe("hi");
	});

	it("propagates doGenerate errors unchanged", async () => {
		const { meter, records } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter);
		await expect(
			mw.wrapGenerate?.({
				doGenerate: async () => {
					throw new Error("provider down");
				},
			}),
		).rejects.toThrow("provider down");
		expect(records).toHaveLength(0);
	});
});

describe("chargebeeMeterMiddleware.wrapStream", () => {
	it("records usage from the AI SDK finish chunk", async () => {
		const { meter, records } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter);
		const result = await mw.wrapStream?.({
			doStream: async () => ({
				stream: streamOf([
					{ type: "text-delta", textDelta: "Hi" },
					{ type: "text-delta", textDelta: " there" },
					{
						type: "finish",
						usage: {
							inputTokens: 8,
							outputTokens: 12,
							cachedInputTokens: 2,
						},
					},
				]),
			}),
		});
		await drain((result as { stream: ReadableStream<unknown> }).stream);
		expect(records).toHaveLength(1);
		expect(records[0].usage).toEqual({
			input: 8,
			output: 12,
			cache_read: 2,
		});
	});

	it("yields every chunk unchanged to the consumer", async () => {
		const { meter } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter);
		const chunks = [
			{ type: "text-delta", textDelta: "a" },
			{ type: "text-delta", textDelta: "b" },
			{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
		];
		const result = await mw.wrapStream?.({
			doStream: async () => ({ stream: streamOf(chunks) }),
		});
		const received = await drain(
			(result as { stream: ReadableStream<unknown> }).stream,
		);
		expect(received).toEqual(chunks);
	});

	it("preserves extra fields from doStream's return value (rawCall, response, etc.)", async () => {
		const { meter } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter);
		const result = await mw.wrapStream?.({
			doStream: async () => ({
				stream: streamOf([{ type: "finish", usage: { inputTokens: 1 } }]),
				rawCall: { rawPrompt: "p", rawSettings: {} },
				warnings: ["w1"],
				request: { body: "..." },
			}),
		});
		const r = result as Record<string, unknown>;
		expect(r.rawCall).toEqual({ rawPrompt: "p", rawSettings: {} });
		expect(r.warnings).toEqual(["w1"]);
		expect(r.request).toEqual({ body: "..." });
	});

	it("forwards the configured context to __record from the finish chunk", async () => {
		const { meter, records } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter, {
			context: { properties: { request_id: "r-42" } },
		});
		const result = await mw.wrapStream?.({
			doStream: async () => ({
				stream: streamOf([
					{ type: "finish", usage: { inputTokens: 5, outputTokens: 3 } },
				]),
			}),
		});
		await drain((result as { stream: ReadableStream<unknown> }).stream);
		expect(records[0].ctx).toEqual({ properties: { request_id: "r-42" } });
	});

	it("ignores non-finish chunks", async () => {
		const { meter, records } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter);
		const result = await mw.wrapStream?.({
			doStream: async () => ({
				stream: streamOf([
					{ type: "text-delta", textDelta: "a" },
					{ type: "text-delta", textDelta: "b" },
				]),
			}),
		});
		await drain((result as { stream: ReadableStream<unknown> }).stream);
		expect(records).toHaveLength(0);
	});

	it("ignores a finish chunk without usage", async () => {
		const { meter, records } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter);
		const result = await mw.wrapStream?.({
			doStream: async () => ({
				stream: streamOf([{ type: "finish", finishReason: "stop" }]),
			}),
		});
		await drain((result as { stream: ReadableStream<unknown> }).stream);
		expect(records).toHaveLength(0);
	});

	it("ignores a finish chunk whose usage is all zero", async () => {
		const { meter, records } = fakeMeter();
		const mw = chargebeeMeterMiddleware(meter);
		const result = await mw.wrapStream?.({
			doStream: async () => ({
				stream: streamOf([
					{ type: "finish", usage: { inputTokens: 0, outputTokens: 0 } },
				]),
			}),
		});
		await drain((result as { stream: ReadableStream<unknown> }).stream);
		expect(records).toHaveLength(0);
	});

	it("swallows meter errors silently mid-stream", async () => {
		const { meter } = fakeMeter({ throwOnRecord: true });
		const mw = chargebeeMeterMiddleware(meter);
		const result = await mw.wrapStream?.({
			doStream: async () => ({
				stream: streamOf([
					{ type: "text-delta", textDelta: "a" },
					{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
				]),
			}),
		});
		const received = await drain(
			(result as { stream: ReadableStream<unknown> }).stream,
		);
		expect(received).toHaveLength(2);
	});
});
