import { describe, expect, it } from "vitest";
import { asyncIter, createFakeCtx, drain } from "./_test-utils.js";
import { openaiAdapter } from "./openai.js";

class OpenAI {
	chat = {
		completions: {
			create: async (params: Record<string, unknown>) => {
				if (params.stream === true) {
					return asyncIter([
						{ choices: [{ delta: { content: "Hi" } }] },
						{ choices: [{ delta: { content: " there" } }] },
						{
							choices: [{ finish_reason: "stop" }],
							usage: {
								prompt_tokens: 10,
								completion_tokens: 5,
								prompt_tokens_details: { cached_tokens: 3 },
							},
						},
					]);
				}
				return {
					id: "chatcmpl-abc",
					choices: [{ message: { content: "Hi" } }],
					usage: {
						prompt_tokens: 42,
						completion_tokens: 17,
						prompt_tokens_details: { cached_tokens: 10, audio_tokens: 4 },
						completion_tokens_details: { reasoning_tokens: 7 },
					},
				};
			},
		},
	};

	responses = {
		create: async (params: Record<string, unknown>) => {
			if (params.stream === true) {
				return asyncIter([
					{ type: "response.output_text.delta", delta: "Hi" },
					{
						type: "response.completed",
						response: {
							usage: {
								input_tokens: 11,
								output_tokens: 6,
								input_tokens_details: { cached_tokens: 2 },
								output_tokens_details: { reasoning_tokens: 4 },
							},
						},
					},
				]);
			}
			return {
				id: "resp-xyz",
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					input_tokens_details: { cached_tokens: 20 },
					output_tokens_details: { reasoning_tokens: 12 },
				},
			};
		},
	};

	embeddings = {
		create: async (_params: unknown) => ({
			data: [{ embedding: [0.1, 0.2] }],
			usage: { prompt_tokens: 8 },
		}),
	};

	completions = {
		create: async (_params: unknown) => ({
			id: "legacy",
			usage: { prompt_tokens: 4, completion_tokens: 2 },
		}),
	};
}

describe("openaiAdapter.matches", () => {
	it("matches an OpenAI instance by constructor name", () => {
		expect(openaiAdapter.matches(new OpenAI())).toBe(true);
	});

	it("matches an AzureOpenAI instance by constructor name", () => {
		class AzureOpenAI {
			chat = { completions: { create: () => {} } };
		}
		expect(openaiAdapter.matches(new AzureOpenAI())).toBe(true);
	});

	it("matches a duck-typed client (chat.completions present)", () => {
		const duck = { chat: { completions: { create: () => {} } } };
		expect(openaiAdapter.matches(duck)).toBe(true);
	});

	it("rejects null / non-objects / unrelated shapes", () => {
		expect(openaiAdapter.matches(null)).toBe(false);
		expect(openaiAdapter.matches("nope")).toBe(false);
		expect(openaiAdapter.matches({ unrelated: true })).toBe(false);
	});
});

describe("openaiAdapter chat.completions.create (non-streaming)", () => {
	it("records canonical usage from a chat completion response", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(new OpenAI(), ctx);
		await (wrapped as OpenAI).chat.completions.create({
			model: "gpt-4o",
			messages: [],
		});
		expect(records).toHaveLength(1);
		expect(records[0].usage).toEqual({
			input: 42,
			output: 17,
			cache_read: 10,
			audio_input: 4,
			reasoning: 7,
		});
	});

	it("does not record when the response has no usage", async () => {
		const client = new OpenAI();
		client.chat.completions.create = (async () => ({
			id: "x",
			choices: [],
		})) as unknown as typeof client.chat.completions.create;
		const { ctx, records } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(client, ctx);
		await (wrapped as OpenAI).chat.completions.create({
			model: "gpt-4o",
			messages: [],
		});
		expect(records).toHaveLength(0);
	});

	it("extracts __chargebee out of params and forwards the clean payload", async () => {
		const seen: Record<string, unknown>[] = [];
		const client = new OpenAI();
		client.chat.completions.create = (async (
			params: Record<string, unknown>,
		) => {
			seen.push(params);
			return { usage: { prompt_tokens: 1, completion_tokens: 1 } };
		}) as unknown as typeof client.chat.completions.create;
		const { ctx, records } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(client, ctx);
		await (wrapped as OpenAI).chat.completions.create({
			model: "gpt-4o",
			messages: [],
			// @ts-expect-error escape hatch is not in the OpenAI typings
			__chargebee: {
				subscriptionId: "sub_explicit",
				properties: { feature: "summarize" },
			},
		});
		expect(seen[0]).not.toHaveProperty("__chargebee");
		expect(records[0].callContext).toEqual({
			subscriptionId: "sub_explicit",
			properties: { feature: "summarize" },
			usageTimestampMs: undefined,
			requestId: undefined,
		});
	});
});

describe("openaiAdapter chat.completions.create (streaming)", () => {
	it("auto-injects stream_options.include_usage when stream:true", async () => {
		const seen: Record<string, unknown>[] = [];
		const client = new OpenAI();
		const original = client.chat.completions.create.bind(
			client.chat.completions,
		);
		client.chat.completions.create = (async (
			params: Record<string, unknown>,
		) => {
			seen.push(params);
			return original(params);
		}) as unknown as typeof client.chat.completions.create;

		const { ctx } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(client, ctx);
		const stream = await (wrapped as OpenAI).chat.completions.create({
			model: "gpt-4o",
			messages: [],
			stream: true,
		});
		await drain(stream as unknown as AsyncIterable<unknown>);

		expect(seen[0]).toMatchObject({
			stream: true,
			stream_options: { include_usage: true },
		});
	});

	it("does NOT add stream_options when stream is not true", async () => {
		const seen: Record<string, unknown>[] = [];
		const client = new OpenAI();
		const original = client.chat.completions.create.bind(
			client.chat.completions,
		);
		client.chat.completions.create = (async (
			params: Record<string, unknown>,
		) => {
			seen.push(params);
			return original(params);
		}) as unknown as typeof client.chat.completions.create;

		const { ctx } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(client, ctx);
		await (wrapped as OpenAI).chat.completions.create({
			model: "gpt-4o",
			messages: [],
		});
		expect(seen[0]).not.toHaveProperty("stream_options");
	});

	it("preserves caller-supplied stream_options fields", async () => {
		const seen: Record<string, unknown>[] = [];
		const client = new OpenAI();
		const original = client.chat.completions.create.bind(
			client.chat.completions,
		);
		client.chat.completions.create = (async (
			params: Record<string, unknown>,
		) => {
			seen.push(params);
			return original(params);
		}) as unknown as typeof client.chat.completions.create;

		const { ctx } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(client, ctx);
		const stream = await (wrapped as OpenAI).chat.completions.create({
			model: "gpt-4o",
			messages: [],
			stream: true,
			stream_options: { include_usage: false, custom: 1 },
		});
		await drain(stream as unknown as AsyncIterable<unknown>);

		expect(seen[0].stream_options).toMatchObject({
			include_usage: false,
			custom: 1,
		});
	});

	it("records usage from the final stream chunk", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(new OpenAI(), ctx);
		const stream = await (wrapped as OpenAI).chat.completions.create({
			model: "gpt-4o",
			messages: [],
			stream: true,
		});
		await drain(stream as unknown as AsyncIterable<unknown>);
		expect(records).toHaveLength(1);
		expect(records[0].usage).toEqual({
			input: 10,
			output: 5,
			cache_read: 3,
		});
	});
});

describe("openaiAdapter responses.create", () => {
	it("non-streaming: extracts input/output/cache_read/reasoning", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(new OpenAI(), ctx);
		await (wrapped as OpenAI).responses.create({ model: "gpt-4o" });
		expect(records[0].usage).toEqual({
			input: 100,
			output: 50,
			cache_read: 20,
			reasoning: 12,
		});
	});

	it("streaming: records usage from response.completed event", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(new OpenAI(), ctx);
		const stream = await (wrapped as OpenAI).responses.create({
			model: "gpt-4o",
			stream: true,
		});
		await drain(stream as unknown as AsyncIterable<unknown>);
		expect(records).toHaveLength(1);
		expect(records[0].usage).toEqual({
			input: 11,
			output: 6,
			cache_read: 2,
			reasoning: 4,
		});
	});

	it("streaming: emits nothing if no response.completed event arrives", async () => {
		const client = new OpenAI();
		client.responses.create = (async () =>
			asyncIter([
				{ type: "response.output_text.delta", delta: "Hi" },
			])) as unknown as typeof client.responses.create;
		const { ctx, records } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(client, ctx);
		const stream = await (wrapped as OpenAI).responses.create({
			model: "gpt-4o",
			stream: true,
		});
		await drain(stream as unknown as AsyncIterable<unknown>);
		expect(records).toHaveLength(0);
	});
});

describe("openaiAdapter embeddings.create", () => {
	it("records prompt_tokens as input", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(new OpenAI(), ctx);
		await (wrapped as OpenAI).embeddings.create({
			model: "text-embedding-3-small",
			input: "hi",
		});
		expect(records[0].usage).toEqual({ input: 8 });
	});
});

describe("openaiAdapter completions.create (legacy)", () => {
	it("records prompt/completion tokens like chat completions", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(new OpenAI(), ctx);
		await (wrapped as OpenAI).completions.create({
			model: "text-davinci-003",
			prompt: "hi",
		});
		expect(records[0].usage).toEqual({ input: 4, output: 2 });
	});
});

describe("openaiAdapter trust contract", () => {
	it("LLM error propagates unchanged; no usage recorded", async () => {
		const client = new OpenAI();
		client.chat.completions.create = (async () => {
			throw new Error("rate limited");
		}) as unknown as typeof client.chat.completions.create;
		const { ctx, records, errors } = createFakeCtx();
		const wrapped = openaiAdapter.wrap(client, ctx);
		await expect(
			(wrapped as OpenAI).chat.completions.create({
				model: "gpt-4o",
				messages: [],
			}),
		).rejects.toThrow("rate limited");
		expect(records).toHaveLength(0);
		expect(errors).toHaveLength(0);
	});
});
