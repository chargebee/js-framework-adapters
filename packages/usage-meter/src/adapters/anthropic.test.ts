import { describe, expect, it } from "vitest";
import { asyncIter, createFakeCtx, drain } from "./_test-utils.js";
import { anthropicAdapter } from "./anthropic.js";

class Anthropic {
	messages = {
		create: async (params: Record<string, unknown>) => {
			if (params.stream === true) {
				return asyncIter([
					{
						type: "message_start",
						message: {
							usage: {
								input_tokens: 12,
								cache_read_input_tokens: 5,
								cache_creation_input_tokens: 7,
								cache_creation: {
									ephemeral_5m_input_tokens: 4,
									ephemeral_1h_input_tokens: 3,
								},
								output_tokens: 1,
							},
						},
					},
					{
						type: "content_block_delta",
						delta: { type: "text_delta", text: "Hi" },
					},
					{ type: "message_delta", usage: { output_tokens: 8 } },
					{ type: "message_delta", usage: { output_tokens: 23 } },
					{ type: "message_stop" },
				]);
			}
			return {
				id: "msg_x",
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					cache_read_input_tokens: 30,
					cache_creation_input_tokens: 25,
					cache_creation: {
						ephemeral_5m_input_tokens: 15,
						ephemeral_1h_input_tokens: 10,
					},
				},
			};
		},
	};
}

describe("anthropicAdapter.matches", () => {
	it("matches an Anthropic instance by constructor name", () => {
		expect(anthropicAdapter.matches(new Anthropic())).toBe(true);
	});

	it("matches an AnthropicBedrock instance", () => {
		class AnthropicBedrock {
			messages = { create: () => {} };
		}
		expect(anthropicAdapter.matches(new AnthropicBedrock())).toBe(true);
	});

	it("matches a duck-typed client (messages present)", () => {
		expect(anthropicAdapter.matches({ messages: { create: () => {} } })).toBe(
			true,
		);
	});

	it("rejects unrelated shapes", () => {
		expect(anthropicAdapter.matches({ foo: 1 })).toBe(false);
		expect(anthropicAdapter.matches(null)).toBe(false);
	});
});

describe("anthropicAdapter messages.create (non-streaming)", () => {
	it("extracts input/output/cache_read and per-TTL writes", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = anthropicAdapter.wrap(new Anthropic(), ctx);
		await (wrapped as Anthropic).messages.create({
			model: "claude-3-5-haiku",
			messages: [],
		});
		expect(records[0].usage).toEqual({
			input: 100,
			output: 50,
			cache_read: 30,
			cache_write_5m: 15,
			cache_write_1h: 10,
		});
	});

	it("falls back to cache_write total when per-TTL fields are absent", async () => {
		const client = new Anthropic();
		client.messages.create = (async () => ({
			usage: {
				input_tokens: 10,
				output_tokens: 5,
				cache_creation_input_tokens: 25,
			},
		})) as unknown as typeof client.messages.create;
		const { ctx, records } = createFakeCtx();
		const wrapped = anthropicAdapter.wrap(client, ctx);
		await (wrapped as Anthropic).messages.create({
			model: "claude-3-5-haiku",
			messages: [],
		});
		expect(records[0].usage).toEqual({
			input: 10,
			output: 5,
			cache_write: 25,
		});
	});

	it("records nothing when usage is missing", async () => {
		const client = new Anthropic();
		client.messages.create = (async () => ({
			id: "x",
		})) as unknown as typeof client.messages.create;
		const { ctx, records } = createFakeCtx();
		const wrapped = anthropicAdapter.wrap(client, ctx);
		await (wrapped as Anthropic).messages.create({
			model: "claude-3-5-haiku",
			messages: [],
		});
		expect(records).toHaveLength(0);
	});
});

describe("anthropicAdapter messages.create (streaming)", () => {
	it("accumulates input from message_start and latest output_tokens from message_delta", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = anthropicAdapter.wrap(new Anthropic(), ctx);
		const stream = await (wrapped as Anthropic).messages.create({
			model: "claude-3-5-haiku",
			messages: [],
			stream: true,
		});
		await drain(stream as unknown as AsyncIterable<unknown>);
		expect(records).toHaveLength(1);
		expect(records[0].usage).toEqual({
			input: 12,
			output: 23,
			cache_read: 5,
			cache_write_5m: 4,
			cache_write_1h: 3,
		});
	});

	it("records exactly once even with multiple message_delta events", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = anthropicAdapter.wrap(new Anthropic(), ctx);
		const stream = await (wrapped as Anthropic).messages.create({
			model: "claude-3-5-haiku",
			messages: [],
			stream: true,
		});
		await drain(stream as unknown as AsyncIterable<unknown>);
		expect(records).toHaveLength(1);
	});

	it("propagates LLM errors mid-stream and does not record partial usage", async () => {
		const client = new Anthropic();
		client.messages.create = (async () => ({
			[Symbol.asyncIterator]() {
				let n = 0;
				return {
					async next() {
						if (n++ === 0) {
							return {
								value: {
									type: "message_start",
									message: { usage: { input_tokens: 5, output_tokens: 1 } },
								},
								done: false,
							};
						}
						throw new Error("stream broke");
					},
				};
			},
		})) as unknown as typeof client.messages.create;

		const { ctx, records } = createFakeCtx();
		const wrapped = anthropicAdapter.wrap(client, ctx);
		const stream = await (wrapped as Anthropic).messages.create({
			model: "claude-3-5-haiku",
			messages: [],
			stream: true,
		});

		await expect(drain(stream as AsyncIterable<unknown>)).rejects.toThrow(
			"stream broke",
		);
		expect(records).toHaveLength(1);
		expect(records[0].usage.input).toBe(5);
	});
});
