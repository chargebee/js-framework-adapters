import { describe, expect, it } from "vitest";
import { asyncIter, createFakeCtx, drain } from "./_test-utils.js";
import { geminiAdapter } from "./gemini.js";

class GoogleGenAI {
	models = {
		generateContent: async (_params: Record<string, unknown>) => ({
			text: "Hi",
			usageMetadata: {
				promptTokenCount: 11,
				candidatesTokenCount: 7,
				cachedContentTokenCount: 2,
				thoughtsTokenCount: 3,
				promptTokensDetails: [
					{ modality: "IMAGE", tokenCount: 100 },
					{ modality: "AUDIO", tokenCount: 50 },
					{ modality: "TEXT", tokenCount: 9 },
				],
			},
		}),
		generateContentStream: async (_params: Record<string, unknown>) =>
			asyncIter([
				{ text: "Hi" },
				{ text: " there" },
				{
					text: "",
					usageMetadata: {
						promptTokenCount: 8,
						candidatesTokenCount: 12,
					},
				},
			]),
	};
}

describe("geminiAdapter.matches", () => {
	it("matches a GoogleGenAI instance by constructor name", () => {
		expect(geminiAdapter.matches(new GoogleGenAI())).toBe(true);
	});

	it("matches a GoogleGenerativeAI instance", () => {
		class GoogleGenerativeAI {
			models = {};
		}
		expect(geminiAdapter.matches(new GoogleGenerativeAI())).toBe(true);
	});

	it("matches a duck-typed client (models present)", () => {
		expect(geminiAdapter.matches({ models: {} })).toBe(true);
	});

	it("rejects unrelated shapes", () => {
		expect(geminiAdapter.matches({ foo: 1 })).toBe(false);
		expect(geminiAdapter.matches(null)).toBe(false);
	});
});

describe("geminiAdapter models.generateContent", () => {
	it("extracts every canonical field from usageMetadata", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = geminiAdapter.wrap(new GoogleGenAI(), ctx);
		await (wrapped as GoogleGenAI).models.generateContent({
			model: "gemini-2.5-flash",
			contents: "hi",
		});
		expect(records[0].usage).toEqual({
			input: 11,
			output: 7,
			cache_read: 2,
			reasoning: 3,
			image_input: 100,
			audio_input: 50,
		});
	});

	it("also accepts the nested response.usageMetadata shape", async () => {
		const client = new GoogleGenAI();
		client.models.generateContent = (async () => ({
			response: {
				usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5 },
			},
		})) as unknown as typeof client.models.generateContent;
		const { ctx, records } = createFakeCtx();
		const wrapped = geminiAdapter.wrap(client, ctx);
		await (wrapped as GoogleGenAI).models.generateContent({
			model: "gemini-2.5-flash",
			contents: "hi",
		});
		expect(records[0].usage).toEqual({ input: 3, output: 5 });
	});

	it("records nothing when usageMetadata is missing", async () => {
		const client = new GoogleGenAI();
		client.models.generateContent = (async () => ({
			text: "Hi",
		})) as unknown as typeof client.models.generateContent;
		const { ctx, records } = createFakeCtx();
		const wrapped = geminiAdapter.wrap(client, ctx);
		await (wrapped as GoogleGenAI).models.generateContent({
			model: "gemini-2.5-flash",
			contents: "hi",
		});
		expect(records).toHaveLength(0);
	});
});

describe("geminiAdapter models.generateContentStream", () => {
	it("uses the most recent usageMetadata (final chunk cumulative)", async () => {
		const { ctx, records } = createFakeCtx();
		const wrapped = geminiAdapter.wrap(new GoogleGenAI(), ctx);
		const stream = await (wrapped as GoogleGenAI).models.generateContentStream({
			model: "gemini-2.5-flash",
			contents: "hi",
		});
		await drain(stream as AsyncIterable<unknown>);
		expect(records).toHaveLength(1);
		expect(records[0].usage).toEqual({ input: 8, output: 12 });
	});

	it("preserves Stream-like wrapper properties via Proxy delegation", async () => {
		const { ctx } = createFakeCtx();
		const client = new GoogleGenAI();
		const tagged = Object.assign(
			(async function* gen() {
				yield { text: "hi", usageMetadata: { promptTokenCount: 1 } };
			})(),
			{ marker: "preserved" },
		);
		client.models.generateContentStream = (async () =>
			tagged) as unknown as typeof client.models.generateContentStream;

		const wrapped = geminiAdapter.wrap(client, ctx);
		const stream = await (wrapped as GoogleGenAI).models.generateContentStream({
			model: "gemini-2.5-flash",
			contents: "hi",
		});
		expect((stream as unknown as { marker?: string }).marker).toBe("preserved");
	});
});
