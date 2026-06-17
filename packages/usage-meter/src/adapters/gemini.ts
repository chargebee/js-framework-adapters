import type { Adapter, CanonicalUsage } from "../types.js";
import {
	extractChargebeeFromOptions,
	type MethodSpec,
	type StreamUsageSpec,
	wrapByMethodPaths,
} from "../wrap.js";

/** Wraps the `@google/genai` (Gemini) client. */
export const geminiAdapter: Adapter<object> = {
	name: "gemini",

	matches(client: unknown): client is object {
		if (!isObject(client)) return false;
		const proto = Object.getPrototypeOf(client) as {
			constructor?: { name?: string };
		} | null;
		const ctorName = proto?.constructor?.name ?? "";
		if (ctorName === "GoogleGenAI" || ctorName === "GoogleGenerativeAI") {
			return true;
		}
		const c = client as Record<string, unknown>;
		return (
			isObject(c.models) ||
			isObject((c as { getGenerativeModel?: unknown }).getGenerativeModel)
		);
	},

	wrap(client, ctx) {
		return wrapByMethodPaths(client, GEMINI_METHODS, ctx);
	},
};

const GEMINI_METHODS: MethodSpec[] = [
	{
		path: ["models", "generateContent"],
		extractUsage: extractGenerateContentUsage,
		extractCallContext: extractChargebeeFromOptions,
	},
	{
		path: ["models", "generateContentStream"],
		extractUsage: extractGenerateContentUsage,
		extractCallContext: extractChargebeeFromOptions,
		streamUsage: generateContentStreamUsage(),
	},
];

/**
 * Gemini reports usage on `response.usageMetadata` with:
 * `promptTokenCount`, `candidatesTokenCount`, `cachedContentTokenCount`,
 * `thoughtsTokenCount` and per-modality token counts.
 */
function extractGenerateContentUsage(
	response: unknown,
): Partial<CanonicalUsage> {
	if (!isObject(response)) return {};
	const meta = pickUsageMetadata(response);
	if (!meta) return {};
	return canonicalFromMeta(meta);
}

/**
 * Streaming: every chunk has a partial `usageMetadata`; the final chunk
 * carries the cumulative totals. We keep the most recent and emit at end.
 */
function generateContentStreamUsage(): StreamUsageSpec<
	unknown,
	{ meta?: Record<string, unknown> }
> {
	return {
		initial: () => ({ meta: undefined }),
		onChunk: (chunk, acc) => {
			if (!isObject(chunk)) return acc;
			const meta = pickUsageMetadata(chunk);
			if (meta) acc.meta = meta;
			return acc;
		},
		finalize: (acc) => (acc.meta ? canonicalFromMeta(acc.meta) : {}),
	};
}

function canonicalFromMeta(
	meta: Record<string, unknown>,
): Partial<CanonicalUsage> {
	const out: Partial<CanonicalUsage> = {};
	const input = num(meta.promptTokenCount);
	if (input) out.input = input;
	const output = num(meta.candidatesTokenCount);
	if (output) out.output = output;
	const cacheRead = num(meta.cachedContentTokenCount);
	if (cacheRead) out.cache_read = cacheRead;
	const reasoning = num(meta.thoughtsTokenCount);
	if (reasoning) out.reasoning = reasoning;

	const promptDetails = Array.isArray(meta.promptTokensDetails)
		? (meta.promptTokensDetails as Array<Record<string, unknown>>)
		: [];
	for (const detail of promptDetails) {
		const modality = typeof detail.modality === "string" ? detail.modality : "";
		const count = num(detail.tokenCount);
		if (!count) continue;
		if (modality === "IMAGE") out.image_input = (out.image_input ?? 0) + count;
		if (modality === "AUDIO") out.audio_input = (out.audio_input ?? 0) + count;
	}
	return out;
}

function pickUsageMetadata(
	response: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (isObject(response.usageMetadata)) {
		return response.usageMetadata as Record<string, unknown>;
	}
	const inner = isObject(response.response)
		? (response.response as Record<string, unknown>)
		: undefined;
	if (inner && isObject(inner.usageMetadata)) {
		return inner.usageMetadata as Record<string, unknown>;
	}
	return undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object";
}

function num(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}
