import type { Adapter, CallContext, CanonicalUsage } from "../types.js";
import {
	type MethodSpec,
	type StreamHandle,
	type StreamUsageSpec,
	wrapByMethodPaths,
} from "../wrap.js";

/**
 * Wraps `@aws-sdk/client-bedrock-runtime`'s `BedrockRuntimeClient`. The SDK's
 * command pattern is `client.send(new ConverseCommand({...}))` / `new
 * ConverseStreamCommand({...})`, so we intercept `.send` and dispatch to the
 * right path based on whether the response is a stream wrapper.
 */
export const bedrockAdapter: Adapter<object> = {
	name: "bedrock",

	matches(client: unknown): client is object {
		if (!isObject(client)) return false;
		const proto = Object.getPrototypeOf(client) as {
			constructor?: { name?: string };
		} | null;
		const ctorName = proto?.constructor?.name ?? "";
		if (/^Bedrock(Runtime)?Client$/.test(ctorName)) return true;
		return typeof (client as { send?: unknown }).send === "function";
	},

	wrap(client, ctx) {
		return wrapByMethodPaths(client, BEDROCK_METHODS, ctx);
	},
};

const BEDROCK_METHODS: MethodSpec[] = [
	{
		path: ["send"],
		extractUsage: extractBedrockUsage,
		extractCallContext: extractFromCommand,
		streamUsage: bedrockStreamUsage(),
	},
];

/**
 * Bedrock Converse response: `{ usage: { inputTokens, outputTokens, totalTokens } }`.
 * `InvokeModel` returns a `Uint8Array` body — token usage isn't directly
 * available, so we skip those (callers should use `ConverseCommand`).
 */
function extractBedrockUsage(response: unknown): Partial<CanonicalUsage> {
	if (!isObject(response)) return {};
	const usage = (response as { usage?: unknown }).usage;
	if (!isObject(usage)) return {};
	const u = usage as Record<string, unknown>;

	const out: Partial<CanonicalUsage> = {};
	const input = num(u.inputTokens);
	if (input) out.input = input;
	const output = num(u.outputTokens);
	if (output) out.output = output;
	const cacheRead = num(u.cacheReadInputTokens);
	if (cacheRead) out.cache_read = cacheRead;
	const cacheWrite = num(u.cacheWriteInputTokens);
	if (cacheWrite) out.cache_write = cacheWrite;
	return out;
}

/**
 * `ConverseStreamCommand` returns `{ stream: AsyncIterable<…>, $metadata }`.
 * We hand the inner iterable to the passthrough wrapper and rebuild the
 * outer object so the AWS SDK consumer sees the same shape.
 *
 * Event shape: one key per event type, e.g. `{ metadata: { usage: {...} } }`,
 * `{ messageStart: {...} }`, `{ contentBlockDelta: {...} }`, etc. We only
 * care about the `metadata` event for usage.
 */
function bedrockStreamUsage(): StreamUsageSpec<
	unknown,
	{ usage?: Record<string, unknown> }
> {
	return {
		initial: () => ({ usage: undefined }),
		onChunk: (chunk, acc) => {
			if (!isObject(chunk)) return acc;
			const metadata = (chunk as { metadata?: unknown }).metadata;
			if (isObject(metadata) && isObject(metadata.usage)) {
				acc.usage = metadata.usage as Record<string, unknown>;
			}
			return acc;
		},
		finalize: (acc) =>
			acc.usage ? extractBedrockUsage({ usage: acc.usage }) : {},
		pickIterable: (value): StreamHandle<unknown> | undefined => {
			if (!isObject(value)) return undefined;
			const inner = (value as { stream?: unknown }).stream;
			if (!isAsyncIterable(inner)) return undefined;
			return {
				iterable: inner,
				rebuild: (wrapped) => ({ ...value, stream: wrapped }),
			};
		},
	};
}

/**
 * Strip `__chargebee` off the command's `input` (and the command itself) before
 * forwarding to AWS. We never mutate the caller's command; instead we shallow-
 * clone any field we need to scrub.
 */
function extractFromCommand(args: unknown[]): {
	cleanArgs: unknown[];
	context?: CallContext;
} {
	if (args.length === 0 || !isObject(args[0])) return { cleanArgs: args };
	const command = args[0] as Record<string, unknown>;
	const escapeHatch =
		(command.__chargebee as CallContext | undefined) ??
		(isObject(command.input)
			? ((command.input as Record<string, unknown>).__chargebee as
					| CallContext
					| undefined)
			: undefined);
	if (!escapeHatch) return { cleanArgs: args };

	const cleaned = { ...command };
	delete cleaned.__chargebee;
	if (isObject(cleaned.input)) {
		const { __chargebee, ...rest } = cleaned.input as Record<string, unknown>;
		void __chargebee;
		cleaned.input = rest;
	}
	const proto = Object.getPrototypeOf(command);
	const rebuilt = Object.assign(Object.create(proto), cleaned);
	return { cleanArgs: [rebuilt, ...args.slice(1)], context: escapeHatch };
}

function isObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object";
}

function isAsyncIterable(v: unknown): v is AsyncIterable<unknown> {
	return (
		!!v &&
		(typeof v === "object" || typeof v === "function") &&
		typeof (v as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
			"function"
	);
}

function num(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}
