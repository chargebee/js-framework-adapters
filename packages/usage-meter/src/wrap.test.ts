import { describe, expect, it, vi } from "vitest";
import type { WrapContext } from "./types.js";
import {
	extractChargebeeFromOptions,
	type MethodSpec,
	wrapByMethodPaths,
} from "./wrap.js";

function makeCtx(): {
	ctx: WrapContext;
	records: Array<unknown>;
	errors: Array<{ err: Error; where: string }>;
} {
	const records: unknown[] = [];
	const errors: Array<{ err: Error; where: string }> = [];
	const ctx: WrapContext = {
		record: vi.fn((usage, callContext) => {
			records.push({ usage, callContext });
		}),
		onError: vi.fn((err, where) => {
			errors.push({ err, where });
		}),
	};
	return { ctx, records, errors };
}

async function* asyncIter<T>(items: T[]): AsyncIterable<T> {
	for (const item of items) yield item;
}

async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const item of stream) out.push(item);
	return out;
}

describe("wrapByMethodPaths — Proxy semantics", () => {
	it("passes through unmapped properties unchanged", () => {
		const client = {
			version: "1.2.3",
			helper: () => "ok",
		};
		const specs: MethodSpec[] = [];
		const { ctx } = makeCtx();
		const wrapped = wrapByMethodPaths(client, specs, ctx);
		expect(wrapped.version).toBe("1.2.3");
		expect(wrapped.helper()).toBe("ok");
	});

	it("invokes the wrapped function with the same args and `this`", async () => {
		const seen: Array<{ args: unknown[]; thisIs: unknown }> = [];
		const client = {
			api: {
				call: async function (this: unknown, ...args: unknown[]) {
					seen.push({ args, thisIs: this });
					return { usage: {} };
				},
			},
		};
		const specs: MethodSpec[] = [
			{
				path: ["api", "call"],
				extractUsage: () => ({}),
			},
		];
		const { ctx } = makeCtx();
		const wrapped = wrapByMethodPaths(client, specs, ctx);
		await wrapped.api.call("hello", 42);
		expect(seen[0].args).toEqual(["hello", 42]);
		expect(seen[0].thisIs).toBe(client.api);
	});

	it("captures usage from a resolved Promise via extractUsage", async () => {
		const client = {
			call: async () => ({ usage: { input: 5, output: 3 } }),
		};
		const specs: MethodSpec[] = [
			{
				path: ["call"],
				extractUsage: (resp: unknown) => {
					const usage = (resp as { usage: { input: number; output: number } })
						.usage;
					return { input: usage.input, output: usage.output };
				},
			},
		];
		const { ctx, records } = makeCtx();
		const wrapped = wrapByMethodPaths(client, specs, ctx);
		await wrapped.call();
		expect(records).toHaveLength(1);
	});

	it("LLM provider errors propagate unchanged (trust contract)", async () => {
		const client = {
			call: async () => {
				throw new Error("provider boom");
			},
		};
		const specs: MethodSpec[] = [{ path: ["call"], extractUsage: () => ({}) }];
		const { ctx, records, errors } = makeCtx();
		const wrapped = wrapByMethodPaths(client, specs, ctx);
		await expect(wrapped.call()).rejects.toThrow("provider boom");
		expect(records).toHaveLength(0);
		expect(errors).toHaveLength(0);
	});

	it("extractUsage errors do NOT break the call; they go to onError", async () => {
		const client = { call: async () => ({ usage: { input: 1 } }) };
		const specs: MethodSpec[] = [
			{
				path: ["call"],
				extractUsage: () => {
					throw new Error("extractor blew up");
				},
			},
		];
		const { ctx, records, errors } = makeCtx();
		const wrapped = wrapByMethodPaths(client, specs, ctx);
		const result = await wrapped.call();
		expect((result as { usage: { input: number } }).usage.input).toBe(1);
		expect(records).toHaveLength(0);
		expect(errors[0].where).toBe("extractUsage");
	});

	it("does not record when extractUsage returns empty / all-zero usage", async () => {
		const client = { call: async () => ({}) };
		const specs: MethodSpec[] = [
			{
				path: ["call"],
				extractUsage: () => ({ input: 0, output: 0 }),
			},
		];
		const { ctx, records } = makeCtx();
		const wrapped = wrapByMethodPaths(client, specs, ctx);
		await wrapped.call();
		expect(records).toHaveLength(0);
	});

	it("supports synchronous (non-Promise) method returns", () => {
		const client = { sync: () => ({ usage: { input: 7 } }) };
		const specs: MethodSpec[] = [
			{
				path: ["sync"],
				extractUsage: (r) => ({
					input: (r as { usage: { input: number } }).usage.input,
				}),
			},
		];
		const { ctx, records } = makeCtx();
		const wrapped = wrapByMethodPaths(client, specs, ctx);
		const result = wrapped.sync();
		expect(records).toHaveLength(1);
		expect(result).toEqual({ usage: { input: 7 } });
	});

	it("forwards extractCallContext-extracted context to record()", async () => {
		const client = { call: async () => ({ usage: { input: 1 } }) };
		const specs: MethodSpec[] = [
			{
				path: ["call"],
				extractUsage: () => ({ input: 1 }),
				extractCallContext: extractChargebeeFromOptions,
			},
		];
		const { ctx, records } = makeCtx();
		const wrapped = wrapByMethodPaths(client, specs, ctx);
		await wrapped.call({
			model: "x",
			__chargebee: {
				subscriptionId: "sub_y",
				properties: { feature: "test" },
			},
		});
		expect(records).toHaveLength(1);
		const rec = records[0] as { callContext: { subscriptionId: string } };
		expect(rec.callContext.subscriptionId).toBe("sub_y");
	});

	it("does not crash when extractCallContext itself throws", async () => {
		const client = { call: async () => ({ usage: { input: 1 } }) };
		const specs: MethodSpec[] = [
			{
				path: ["call"],
				extractUsage: () => ({ input: 1 }),
				extractCallContext: () => {
					throw new Error("extractor blew up");
				},
			},
		];
		const { ctx, errors } = makeCtx();
		const wrapped = wrapByMethodPaths(client, specs, ctx);
		await wrapped.call({ model: "x" });
		expect(errors.find((e) => e.where === "wrap")).toBeDefined();
	});
});

describe("wrapByMethodPaths — streaming passthrough", () => {
	const streamSpec = (): MethodSpec => ({
		path: ["stream"],
		extractUsage: () => ({}),
		streamUsage: {
			initial: () => ({
				usage: undefined as Record<string, number> | undefined,
			}),
			onChunk: (chunk, acc) => {
				const c = chunk as { usage?: Record<string, number> };
				if (c.usage) acc.usage = c.usage;
				return acc;
			},
			finalize: (acc) =>
				acc.usage
					? { input: acc.usage.input ?? 0, output: acc.usage.output ?? 0 }
					: {},
		},
	});

	it("yields the same chunks to the consumer", async () => {
		const client = {
			stream: () => asyncIter([{ text: "a" }, { text: "b" }]),
		};
		const { ctx } = makeCtx();
		const wrapped = wrapByMethodPaths(client, [streamSpec()], ctx);
		const items = await drain(wrapped.stream() as AsyncIterable<unknown>);
		expect(items).toEqual([{ text: "a" }, { text: "b" }]);
	});

	it("records usage exactly once after the stream completes", async () => {
		const client = {
			stream: () =>
				asyncIter([
					{ text: "a" },
					{ text: "b" },
					{ usage: { input: 10, output: 5 } },
				]),
		};
		const { ctx, records } = makeCtx();
		const wrapped = wrapByMethodPaths(client, [streamSpec()], ctx);
		await drain(wrapped.stream() as AsyncIterable<unknown>);
		expect(records).toHaveLength(1);
	});

	it("records exactly once even if the consumer breaks early", async () => {
		const client = {
			stream: () =>
				asyncIter([
					{ text: "a", usage: { input: 10, output: 5 } },
					{ text: "b" },
					{ text: "c" },
				]),
		};
		const { ctx, records } = makeCtx();
		const wrapped = wrapByMethodPaths(client, [streamSpec()], ctx);
		for await (const _ of wrapped.stream() as AsyncIterable<unknown>) {
			break;
		}
		expect(records).toHaveLength(1);
	});

	it("records usage even when the upstream stream errors mid-way", async () => {
		const client = {
			stream: () => ({
				[Symbol.asyncIterator]() {
					let n = 0;
					return {
						async next() {
							if (n++ === 0) {
								return {
									value: { usage: { input: 4, output: 2 } },
									done: false,
								};
							}
							throw new Error("net blip");
						},
					};
				},
			}),
		};
		const { ctx, records } = makeCtx();
		const wrapped = wrapByMethodPaths(client, [streamSpec()], ctx);
		await expect(
			drain(wrapped.stream() as AsyncIterable<unknown>),
		).rejects.toThrow("net blip");
		expect(records).toHaveLength(1);
	});

	it("preserves non-iterator properties on the original stream object (e.g. .controller)", async () => {
		const client = {
			stream: () => {
				const it = asyncIter([{ usage: { input: 1 } }]);
				return Object.assign(it, {
					controller: { aborted: false },
					tee: () => "tee-result",
				});
			},
		};
		const { ctx } = makeCtx();
		const wrapped = wrapByMethodPaths(client, [streamSpec()], ctx);
		const stream = wrapped.stream() as AsyncIterable<unknown> & {
			controller: { aborted: boolean };
			tee: () => string;
		};
		expect(stream.controller.aborted).toBe(false);
		expect(stream.tee()).toBe("tee-result");
	});

	it("uses pickIterable for wrapper-shaped responses (Bedrock pattern)", async () => {
		const client = {
			stream: async () => ({
				$metadata: { requestId: "r1" },
				stream: asyncIter([{ usage: { input: 9 } }]),
			}),
		};
		const spec: MethodSpec = {
			path: ["stream"],
			extractUsage: () => ({}),
			streamUsage: {
				initial: () => ({
					usage: undefined as Record<string, number> | undefined,
				}),
				onChunk: (chunk, acc) => {
					const c = chunk as { usage?: Record<string, number> };
					if (c.usage) acc.usage = c.usage;
					return acc;
				},
				finalize: (acc) => (acc.usage ? { input: acc.usage.input ?? 0 } : {}),
				pickIterable: (value) => {
					const v = value as { stream: AsyncIterable<unknown> };
					return {
						iterable: v.stream,
						rebuild: (wrapped) => ({ ...v, stream: wrapped }),
					};
				},
			},
		};
		const { ctx, records } = makeCtx();
		const wrapped = wrapByMethodPaths(client, [spec], ctx);
		const result = (await wrapped.stream()) as {
			$metadata: { requestId: string };
			stream: AsyncIterable<unknown>;
		};
		expect(result.$metadata.requestId).toBe("r1");
		await drain(result.stream);
		expect(records).toHaveLength(1);
	});

	it("finalize errors do NOT propagate into the consumer", async () => {
		const spec: MethodSpec = {
			path: ["stream"],
			extractUsage: () => ({}),
			streamUsage: {
				initial: () => ({}),
				onChunk: (_chunk, acc) => acc,
				finalize: () => {
					throw new Error("finalize blew up");
				},
			},
		};
		const client = { stream: () => asyncIter([{ a: 1 }, { b: 2 }]) };
		const { ctx, records, errors } = makeCtx();
		const wrapped = wrapByMethodPaths(client, [spec], ctx);
		const items = await drain(wrapped.stream() as AsyncIterable<unknown>);
		expect(items).toHaveLength(2);
		expect(records).toHaveLength(0);
		expect(errors.find((e) => e.where === "extractUsage")).toBeDefined();
	});

	it("onChunk errors do NOT abort the stream", async () => {
		const spec: MethodSpec = {
			path: ["stream"],
			extractUsage: () => ({}),
			streamUsage: {
				initial: () => ({ count: 0 }),
				onChunk: (chunk, acc) => {
					if ((chunk as { fail?: boolean }).fail)
						throw new Error("chunk parser broke");
					acc.count++;
					return acc;
				},
				finalize: (acc) => ({ input: acc.count }),
			},
		};
		const client = {
			stream: () => asyncIter([{ x: 1 }, { fail: true }, { x: 2 }]),
		};
		const { ctx, records, errors } = makeCtx();
		const wrapped = wrapByMethodPaths(client, [spec], ctx);
		const items = await drain(wrapped.stream() as AsyncIterable<unknown>);
		expect(items).toHaveLength(3);
		expect(records).toHaveLength(1);
		expect(errors.find((e) => e.where === "extractUsage")).toBeDefined();
	});
});

describe("extractChargebeeFromOptions", () => {
	it("returns args unchanged when no __chargebee field is present", () => {
		const args = [{ model: "x" }];
		const out = extractChargebeeFromOptions(args);
		expect(out.cleanArgs).toBe(args);
		expect(out.context).toBeUndefined();
	});

	it("strips __chargebee and returns the context", () => {
		const args = [
			{
				model: "x",
				__chargebee: {
					subscriptionId: "sub_1",
					properties: { feature: "f" },
					requestId: "r1",
				},
			},
		];
		const out = extractChargebeeFromOptions(args);
		expect(
			(out.cleanArgs[0] as Record<string, unknown>).__chargebee,
		).toBeUndefined();
		expect(out.context).toEqual({
			subscriptionId: "sub_1",
			properties: { feature: "f" },
			usageTimestampMs: undefined,
			requestId: "r1",
		});
	});

	it("preserves trailing args unchanged", () => {
		const args = [{ __chargebee: { subscriptionId: "s" } }, "extra1", 42];
		const out = extractChargebeeFromOptions(args);
		expect(out.cleanArgs.slice(1)).toEqual(["extra1", 42]);
	});

	it("does not mutate the caller's options object", () => {
		const opts = {
			model: "x",
			__chargebee: { subscriptionId: "s" },
		};
		extractChargebeeFromOptions([opts]);
		expect(opts.__chargebee).toBeDefined();
	});

	it("returns args as-is when called with no args", () => {
		const args: unknown[] = [];
		const out = extractChargebeeFromOptions(args);
		expect(out.cleanArgs).toBe(args);
	});
});
