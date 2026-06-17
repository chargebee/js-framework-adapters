import type { Adapter, CanonicalUsage } from "../types.js";
import {
	extractChargebeeFromOptions,
	type MethodSpec,
	type StreamUsageSpec,
	wrapByMethodPaths,
} from "../wrap.js";

/** Wraps the official `@anthropic-ai/sdk` client. */
export const anthropicAdapter: Adapter<object> = {
	name: "anthropic",

	matches(client: unknown): client is object {
		if (!isObject(client)) return false;
		const proto = Object.getPrototypeOf(client) as {
			constructor?: { name?: string };
		} | null;
		const ctorName = proto?.constructor?.name;
		if (ctorName === "Anthropic" || ctorName === "AnthropicBedrock")
			return true;
		const c = client as Record<string, unknown>;
		return isObject(c.messages);
	},

	wrap(client, ctx) {
		return wrapByMethodPaths(client, ANTHROPIC_METHODS, ctx);
	},
};

const ANTHROPIC_METHODS: MethodSpec[] = [
	{
		path: ["messages", "create"],
		extractUsage: extractMessagesUsage,
		extractCallContext: extractChargebeeFromOptions,
		streamUsage: messagesStreamUsage(),
	},
];

/**
 * Anthropic non-streaming `usage` shape:
 * ```
 * {
 *   input_tokens, output_tokens,
 *   cache_creation_input_tokens, cache_read_input_tokens,
 *   cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }
 * }
 * ```
 */
function extractMessagesUsage(response: unknown): Partial<CanonicalUsage> {
	if (!isObject(response)) return {};
	const usage = (response as { usage?: unknown }).usage;
	if (!isObject(usage)) return {};
	const u = usage as Record<string, unknown>;

	const out: Partial<CanonicalUsage> = {};
	const input = num(u.input_tokens);
	if (input) out.input = input;
	const output = num(u.output_tokens);
	if (output) out.output = output;
	const cacheRead = num(u.cache_read_input_tokens);
	if (cacheRead) out.cache_read = cacheRead;

	const cacheCreation = isObject(u.cache_creation)
		? (u.cache_creation as Record<string, unknown>)
		: undefined;
	const cw5m = num(cacheCreation?.ephemeral_5m_input_tokens);
	if (cw5m) out.cache_write_5m = cw5m;
	const cw1h = num(cacheCreation?.ephemeral_1h_input_tokens);
	if (cw1h) out.cache_write_1h = cw1h;

	const cacheWriteTotal = num(u.cache_creation_input_tokens);
	if (cacheWriteTotal && !cw5m && !cw1h) out.cache_write = cacheWriteTotal;

	return out;
}

/**
 * Streaming protocol (Anthropic Messages):
 *   - `message_start` → `message.usage` has `input_tokens`, `cache_*` fields,
 *      plus a tiny initial `output_tokens` (1 or 2).
 *   - `message_delta` → `usage.output_tokens` is the running total — keep the
 *      latest value.
 *
 * We accumulate both into one record and emit at `message_stop` / stream end.
 */
interface AnthropicStreamAcc {
	input: number;
	output: number;
	cache_read: number;
	cache_write_5m: number;
	cache_write_1h: number;
	cache_write: number;
}

function messagesStreamUsage(): StreamUsageSpec<unknown, AnthropicStreamAcc> {
	return {
		initial: () => ({
			input: 0,
			output: 0,
			cache_read: 0,
			cache_write_5m: 0,
			cache_write_1h: 0,
			cache_write: 0,
		}),
		onChunk: (chunk, acc) => {
			if (!isObject(chunk)) return acc;
			const type = (chunk as { type?: unknown }).type;

			if (type === "message_start") {
				const message = (chunk as { message?: unknown }).message;
				const usage = isObject(message)
					? (message as { usage?: unknown }).usage
					: undefined;
				if (isObject(usage)) {
					const u = usage as Record<string, unknown>;
					const input = num(u.input_tokens);
					if (input) acc.input = input;
					const cacheRead = num(u.cache_read_input_tokens);
					if (cacheRead) acc.cache_read = cacheRead;
					const cacheCreation = isObject(u.cache_creation)
						? (u.cache_creation as Record<string, unknown>)
						: undefined;
					const cw5m = num(cacheCreation?.ephemeral_5m_input_tokens);
					if (cw5m) acc.cache_write_5m = cw5m;
					const cw1h = num(cacheCreation?.ephemeral_1h_input_tokens);
					if (cw1h) acc.cache_write_1h = cw1h;
					const cwTotal = num(u.cache_creation_input_tokens);
					if (cwTotal && !cw5m && !cw1h) acc.cache_write = cwTotal;
				}
			} else if (type === "message_delta") {
				const usage = (chunk as { usage?: unknown }).usage;
				if (isObject(usage)) {
					const out = num((usage as Record<string, unknown>).output_tokens);
					if (out) acc.output = out;
				}
			}
			return acc;
		},
		finalize: (acc) => {
			const out: Partial<CanonicalUsage> = {};
			if (acc.input) out.input = acc.input;
			if (acc.output) out.output = acc.output;
			if (acc.cache_read) out.cache_read = acc.cache_read;
			if (acc.cache_write_5m) out.cache_write_5m = acc.cache_write_5m;
			if (acc.cache_write_1h) out.cache_write_1h = acc.cache_write_1h;
			if (acc.cache_write) out.cache_write = acc.cache_write;
			return out;
		},
	};
}

function isObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object";
}

function num(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}
