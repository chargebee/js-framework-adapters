import type { UsageMeter } from "./meter.js";
import type { CallContext, CanonicalUsage } from "./types.js";

/**
 * Vercel AI SDK middleware. Plug into `wrapLanguageModel` so any model the AI
 * SDK supports flows usage to Chargebee.
 *
 * @example
 * ```ts
 * import { wrapLanguageModel, generateText } from "ai";
 * import { openai } from "@ai-sdk/openai";
 * import { chargebeeMeterMiddleware } from "@chargebee/usage-meter/ai-sdk";
 *
 * const model = wrapLanguageModel({
 *   model: openai("gpt-5"),
 *   middleware: chargebeeMeterMiddleware(meter),
 * });
 * ```
 */
export function chargebeeMeterMiddleware(
	meter: UsageMeter,
	options: { context?: CallContext } = {},
): LanguageModelV2Middleware {
	const recordFrom = (result: unknown) => {
		const usage = extractAISDKUsage(result);
		if (!usage) return;
		try {
			(meter as UsageMeterInternal).__record(usage, options.context);
		} catch {
			/* meter handles its own errors via onError */
		}
	};

	return {
		async wrapGenerate({ doGenerate }) {
			const result = await doGenerate();
			recordFrom(result);
			return result;
		},
		async wrapStream({ doStream }) {
			const { stream, ...rest } = await doStream();
			const transformed = stream.pipeThrough(
				new TransformStream<unknown, unknown>({
					transform(chunk, controller) {
						const c = chunk as { type?: string; usage?: unknown } | undefined;
						if (c && c.type === "finish" && c.usage) {
							const usage = extractAISDKUsage({ usage: c.usage });
							if (usage) {
								try {
									(meter as UsageMeterInternal).__record(
										usage,
										options.context,
									);
								} catch {
									/* meter handles its own errors */
								}
							}
						}
						controller.enqueue(chunk);
					},
				}),
			);
			return { stream: transformed, ...rest };
		},
	};
}

/**
 * Translates the AI SDK's normalized `usage` shape onto canonical fields.
 * AI SDK v5 exposes `{ inputTokens, outputTokens, reasoningTokens,
 * cachedInputTokens, totalTokens }`; v4 used `{ promptTokens, completionTokens }`.
 * We accept both.
 */
function extractAISDKUsage(
	result: unknown,
): Partial<CanonicalUsage> | undefined {
	if (!isObject(result)) return undefined;
	const usage = (result as { usage?: unknown }).usage;
	if (!isObject(usage)) return undefined;
	const u = usage as Record<string, unknown>;

	const out: Partial<CanonicalUsage> = {};
	const input = num(u.inputTokens) || num(u.promptTokens);
	if (input) out.input = input;
	const output = num(u.outputTokens) || num(u.completionTokens);
	if (output) out.output = output;
	const cacheRead = num(u.cachedInputTokens) || num(u.cachedPromptTokens);
	if (cacheRead) out.cache_read = cacheRead;
	const reasoning = num(u.reasoningTokens);
	if (reasoning) out.reasoning = reasoning;

	return hasAny(out) ? out : undefined;
}

function hasAny(usage: Partial<CanonicalUsage>): boolean {
	for (const k of Object.keys(usage)) {
		const v = usage[k as keyof CanonicalUsage];
		if (typeof v === "number" && v > 0) return true;
	}
	return false;
}

function isObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object";
}

function num(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Subset of the Vercel AI SDK middleware contract we depend on. Re-declared
 * locally so we don't take a hard `ai` dependency.
 */
export interface LanguageModelV2Middleware {
	wrapGenerate?: (opts: {
		doGenerate: () => Promise<unknown>;
	}) => Promise<unknown>;
	wrapStream?: (opts: {
		doStream: () => Promise<{
			stream: ReadableStream<unknown>;
			[key: string]: unknown;
		}>;
	}) => Promise<{ stream: ReadableStream<unknown>; [key: string]: unknown }>;
}

/**
 * Access to the meter's internal `record` method. Public API on the meter
 * always goes through wrap → adapter → record, but the AI SDK middleware
 * sits outside that pipeline.
 */
interface UsageMeterInternal {
	__record(usage: Partial<CanonicalUsage>, ctx?: CallContext): void;
}
