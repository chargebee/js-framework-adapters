import { describe, expect, it } from "vitest";
import { asyncIter, createFakeCtx, drain } from "./_test-utils.js";
import { bedrockAdapter } from "./bedrock.js";

class ConverseCommand {
	constructor(public input: Record<string, unknown>) {}
}

class ConverseStreamCommand {
	constructor(public input: Record<string, unknown>) {}
}

class BedrockRuntimeClient {
	async send(
		command: ConverseCommand | ConverseStreamCommand,
	): Promise<unknown> {
		if (command instanceof ConverseStreamCommand) {
			return {
				$metadata: { requestId: "req-1", httpStatusCode: 200 },
				stream: asyncIter([
					{ messageStart: { role: "assistant" } },
					{ contentBlockDelta: { delta: { text: "Hi" } } },
					{ messageStop: { stopReason: "end_turn" } },
					{
						metadata: {
							usage: {
								inputTokens: 11,
								outputTokens: 6,
								cacheReadInputTokens: 2,
								cacheWriteInputTokens: 3,
								totalTokens: 17,
							},
						},
					},
				]),
			};
		}
		return {
			$metadata: { requestId: "req-2" },
			output: { message: { role: "assistant" } },
			usage: {
				inputTokens: 100,
				outputTokens: 50,
				cacheReadInputTokens: 30,
				cacheWriteInputTokens: 25,
				totalTokens: 150,
			},
		};
	}
}

describe("bedrockAdapter.matches", () => {
	it("matches BedrockRuntimeClient by constructor name", () => {
		expect(bedrockAdapter.matches(new BedrockRuntimeClient())).toBe(true);
	});

	it("matches anything that has a send() function (broad duck-type)", () => {
		expect(bedrockAdapter.matches({ send: () => {} })).toBe(true);
	});

	it("rejects null / primitives / no-send objects", () => {
		expect(bedrockAdapter.matches(null)).toBe(false);
		expect(bedrockAdapter.matches({ foo: 1 })).toBe(false);
	});
});

describe("bedrockAdapter send (ConverseCommand, non-streaming)", () => {
	it("extracts input/output/cache_read/cache_write from response.usage", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = bedrockAdapter.wrap(new BedrockRuntimeClient(), ctx);
		await (wrapped as BedrockRuntimeClient).send(
			new ConverseCommand({ modelId: "anthropic.claude-3-haiku" }),
		);
		expect(records[0].usage).toEqual({
			input: 100,
			output: 50,
			cache_read: 30,
			cache_write: 25,
		});
	});

	it("records nothing for InvokeModel-style responses without usage", async () => {
		const client = new BedrockRuntimeClient();
		client.send = (async () => ({
			body: new Uint8Array([1, 2, 3]),
			$metadata: {},
		})) as unknown as typeof client.send;
		const { ctx, records } = createFakeCtx();
		const wrapped = bedrockAdapter.wrap(client, ctx);
		await (wrapped as BedrockRuntimeClient).send(
			new ConverseCommand({ modelId: "x" }),
		);
		expect(records).toHaveLength(0);
	});
});

describe("bedrockAdapter send (ConverseStreamCommand)", () => {
	it("preserves the { stream, $metadata } wrapper shape on the response", async () => {
		const { ctx } = createFakeCtx();
		const wrapped = bedrockAdapter.wrap(new BedrockRuntimeClient(), ctx);
		const result = await (wrapped as BedrockRuntimeClient).send(
			new ConverseStreamCommand({ modelId: "x" }),
		);
		const r = result as { stream: unknown; $metadata: { requestId: string } };
		expect(r.$metadata.requestId).toBe("req-1");
		expect(
			typeof (r.stream as { [Symbol.asyncIterator]?: unknown })[
				Symbol.asyncIterator
			],
		).toBe("function");
	});

	it("records usage from the metadata event after the stream drains", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = bedrockAdapter.wrap(new BedrockRuntimeClient(), ctx);
		const result = await (wrapped as BedrockRuntimeClient).send(
			new ConverseStreamCommand({ modelId: "x" }),
		);
		await drain((result as { stream: AsyncIterable<unknown> }).stream);
		expect(records).toHaveLength(1);
		expect(records[0].usage).toEqual({
			input: 11,
			output: 6,
			cache_read: 2,
			cache_write: 3,
		});
	});

	it("emits nothing when no metadata event is present", async () => {
		const client = new BedrockRuntimeClient();
		client.send = (async () => ({
			$metadata: {},
			stream: asyncIter([
				{ messageStart: { role: "assistant" } },
				{ messageStop: { stopReason: "end_turn" } },
			]),
		})) as unknown as typeof client.send;
		const { ctx, records } = createFakeCtx();
		const wrapped = bedrockAdapter.wrap(client, ctx);
		const result = await (wrapped as BedrockRuntimeClient).send(
			new ConverseStreamCommand({ modelId: "x" }),
		);
		await drain((result as { stream: AsyncIterable<unknown> }).stream);
		expect(records).toHaveLength(0);
	});
});

describe("bedrockAdapter __chargebee escape hatch", () => {
	it("scrubs __chargebee from the command before forwarding to AWS", async () => {
		const seen: unknown[] = [];
		const client = new BedrockRuntimeClient();
		const original = client.send.bind(client);
		client.send = ((command: unknown) => {
			seen.push(command);
			return original(command as ConverseCommand);
		}) as unknown as typeof client.send;

		const { ctx, records } = createFakeCtx();
		const wrapped = bedrockAdapter.wrap(client, ctx);
		const command = new ConverseCommand({ modelId: "x" });
		(command as unknown as Record<string, unknown>).__chargebee = {
			subscriptionId: "sub_x",
			properties: { feature: "f" },
		};

		await (wrapped as BedrockRuntimeClient).send(command);

		const forwarded = seen[0] as Record<string, unknown>;
		expect(forwarded.__chargebee).toBeUndefined();
		expect(
			(forwarded.input as Record<string, unknown>).__chargebee,
		).toBeUndefined();
		expect(records[0].callContext?.subscriptionId).toBe("sub_x");
	});

	it("does not mutate the caller's command instance", async () => {
		const { ctx } = createFakeCtx();
		const wrapped = bedrockAdapter.wrap(new BedrockRuntimeClient(), ctx);
		const command = new ConverseCommand({ modelId: "x" });
		(command as unknown as Record<string, unknown>).__chargebee = {
			subscriptionId: "sub_x",
		};
		await (wrapped as BedrockRuntimeClient).send(command);
		expect(
			(command as unknown as Record<string, unknown>).__chargebee,
		).toBeDefined();
	});
});
