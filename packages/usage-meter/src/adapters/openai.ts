import type { Adapter, CanonicalUsage } from "../types.js";
import {
	extractChargebeeFromOptions,
	type MethodSpec,
	type StreamUsageSpec,
	wrapByMethodPaths,
} from "../wrap.js";

/**
 * Wraps the official `openai` JS SDK client. Recognized via duck typing — we
 * don't import `openai` so it stays an optional peer.
 */
export const openaiAdapter: Adapter<object> = {
	name: "openai",

	matches(client: unknown): client is object {
		if (!isObject(client)) return false;
		const proto = Object.getPrototypeOf(client) as {
			constructor?: { name?: string };
		} | null;
		const ctorName = proto?.constructor?.name;
		if (ctorName === "OpenAI" || ctorName === "AzureOpenAI") return true;
		const c = client as Record<string, unknown>;
		return (
			isObject(c.chat) &&
			isObject((c.chat as Record<string, unknown>).completions)
		);
	},

	wrap(client, ctx) {
		return wrapByMethodPaths(client, OPENAI_METHODS, ctx);
	},
};

const OPENAI_METHODS: MethodSpec[] = [
	{
		path: ["chat", "completions", "create"],
		extractUsage: extractChatCompletionUsage,
		extractCallContext: openaiChatExtractCallContext,
		streamUsage: chatCompletionStreamUsage(),
	},
	{
		path: ["responses", "create"],
		extractUsage: extractResponsesUsage,
		extractCallContext: extractChargebeeFromOptions,
		streamUsage: responsesStreamUsage(),
	},
	{
		path: ["completions", "create"],
		extractUsage: extractChatCompletionUsage,
		extractCallContext: openaiChatExtractCallContext,
		streamUsage: chatCompletionStreamUsage(),
	},
	{
		path: ["embeddings", "create"],
		extractUsage: extractEmbeddingUsage,
		extractCallContext: extractChargebeeFromOptions,
	},
];

/**
 * Wraps `extractChargebeeFromOptions` and auto-injects
 * `stream_options.include_usage = true` whenever `stream: true` is set. Without
 * this, OpenAI doesn't send `usage` on streaming chat completion responses —
 * making the auto-inject silently fix a frequent caller mistake. User-provided
 * `stream_options` values take precedence on merge.
 */
function openaiChatExtractCallContext(args: unknown[]): {
	cleanArgs: unknown[];
	context?: import("../types.js").CallContext;
} {
	const base = extractChargebeeFromOptions(args);
	const params = base.cleanArgs[0];
	if (!isObject(params) || params.stream !== true) return base;
	const existing = (params.stream_options ?? {}) as Record<string, unknown>;
	const merged = {
		...params,
		stream_options: { include_usage: true, ...existing },
	};
	return {
		cleanArgs: [merged, ...base.cleanArgs.slice(1)],
		context: base.context,
	};
}

/** `usage: { prompt_tokens, completion_tokens, ... }` (Chat Completions / legacy). */
function extractChatCompletionUsage(
	response: unknown,
): Partial<CanonicalUsage> {
	const usage = getUsage(response);
	if (!usage) return {};
	const out: Partial<CanonicalUsage> = {};
	const input = num(usage.prompt_tokens);
	if (input) out.input = input;
	const output = num(usage.completion_tokens);
	if (output) out.output = output;

	const promptDetails = isObject(usage.prompt_tokens_details)
		? (usage.prompt_tokens_details as Record<string, unknown>)
		: undefined;
	const cacheRead = num(promptDetails?.cached_tokens);
	if (cacheRead) out.cache_read = cacheRead;
	const audioIn = num(promptDetails?.audio_tokens);
	if (audioIn) out.audio_input = audioIn;
	const imageIn = num(promptDetails?.image_tokens);
	if (imageIn) out.image_input = imageIn;

	const completionDetails = isObject(usage.completion_tokens_details)
		? (usage.completion_tokens_details as Record<string, unknown>)
		: undefined;
	const reasoning = num(completionDetails?.reasoning_tokens);
	if (reasoning) out.reasoning = reasoning;

	return out;
}

/** `usage: { input_tokens, output_tokens, ... }` (Responses API). */
function extractResponsesUsage(response: unknown): Partial<CanonicalUsage> {
	const usage = getUsage(response);
	if (!usage) return {};
	const out: Partial<CanonicalUsage> = {};
	const input = num(usage.input_tokens);
	if (input) out.input = input;
	const output = num(usage.output_tokens);
	if (output) out.output = output;

	const inputDetails = isObject(usage.input_tokens_details)
		? (usage.input_tokens_details as Record<string, unknown>)
		: undefined;
	const cacheRead = num(inputDetails?.cached_tokens);
	if (cacheRead) out.cache_read = cacheRead;

	const outputDetails = isObject(usage.output_tokens_details)
		? (usage.output_tokens_details as Record<string, unknown>)
		: undefined;
	const reasoning = num(outputDetails?.reasoning_tokens);
	if (reasoning) out.reasoning = reasoning;

	return out;
}

function extractEmbeddingUsage(response: unknown): Partial<CanonicalUsage> {
	const usage = getUsage(response);
	if (!usage) return {};
	const input = num(usage.prompt_tokens);
	return input ? { input } : {};
}

/**
 * Chat-completion streaming: the last chunk carries `chunk.usage` when
 * `stream_options: { include_usage: true }` was set (auto-injected above).
 */
function chatCompletionStreamUsage(): StreamUsageSpec<
	unknown,
	{ usage?: Record<string, unknown> }
> {
	return {
		initial: () => ({ usage: undefined }),
		onChunk: (chunk, acc) => {
			if (isObject(chunk) && isObject((chunk as { usage?: unknown }).usage)) {
				acc.usage = (chunk as { usage: Record<string, unknown> }).usage;
			}
			return acc;
		},
		finalize: (acc) =>
			acc.usage ? extractChatCompletionUsage({ usage: acc.usage }) : {},
	};
}

/**
 * Responses-API streaming: the `response.completed` event carries
 * `event.response.usage`.
 */
function responsesStreamUsage(): StreamUsageSpec<
	unknown,
	{ usage?: Record<string, unknown> }
> {
	return {
		initial: () => ({ usage: undefined }),
		onChunk: (chunk, acc) => {
			if (
				isObject(chunk) &&
				(chunk as { type?: unknown }).type === "response.completed"
			) {
				const response = (chunk as { response?: unknown }).response;
				if (isObject(response) && isObject(response.usage)) {
					acc.usage = response.usage as Record<string, unknown>;
				}
			}
			return acc;
		},
		finalize: (acc) =>
			acc.usage ? extractResponsesUsage({ usage: acc.usage }) : {},
	};
}

function getUsage(response: unknown): Record<string, unknown> | undefined {
	if (!isObject(response)) return undefined;
	const usage = (response as { usage?: unknown }).usage;
	return isObject(usage) ? (usage as Record<string, unknown>) : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object";
}

function num(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}
