import type {
	CallContext,
	CanonicalUsage,
	EventProperties,
	WrapContext,
} from "./types.js";

/** Extract usage from a finished, non-streaming LLM response. */
export type ExtractUsage = (response: unknown) => Partial<CanonicalUsage>;

/**
 * Optionally pluck `__chargebee` (or any other escape-hatch field) out of the
 * call arguments before forwarding. Must return both the cleaned arguments and
 * the extracted context.
 */
export type ExtractCallContext = (args: unknown[]) => {
	cleanArgs: unknown[];
	context?: CallContext;
};

/**
 * Locate the async iterable inside a streaming call's return value, plus how
 * to rebuild that return value with our wrapped iterable substituted in.
 *
 * Used by adapters whose stream method returns a wrapper object (e.g. Bedrock
 * returns `{ stream, $metadata }`). When the return value is the iterable
 * itself (OpenAI / Anthropic / Gemini), omit `pickIterable` — the default
 * wraps via a Proxy that delegates non-iterator properties to the original.
 */
export interface StreamHandle<Chunk> {
	iterable: AsyncIterable<Chunk>;
	rebuild: (wrapped: AsyncIterable<Chunk>) => unknown;
}

/**
 * Per-method streaming spec. Adapters provide this alongside `extractUsage`
 * for any call path that can return a stream. The runtime auto-detects which
 * path applies based on the return value.
 */
export interface StreamUsageSpec<Chunk = unknown, Acc = unknown> {
	initial: () => Acc;
	/** Called for every chunk as the consumer iterates. Returns the new acc. */
	onChunk: (chunk: Chunk, acc: Acc) => Acc;
	/** Called once after the stream completes (or errors). Returns the canonical usage. */
	finalize: (acc: Acc) => Partial<CanonicalUsage>;
	/** Optional locator for wrapper-shaped returns. */
	pickIterable?: (value: unknown) => StreamHandle<Chunk> | undefined;
}

export interface MethodSpec {
	/** Dotted method path on the client, e.g. `["chat", "completions", "create"]`. */
	path: string[];
	extractUsage: ExtractUsage;
	extractCallContext?: ExtractCallContext;
	// biome-ignore lint/suspicious/noExplicitAny: existential type over Chunk/Acc; runtime is checked
	streamUsage?: StreamUsageSpec<any, any>;
}

interface Node {
	spec?: MethodSpec;
	children: Map<string, Node>;
}

/**
 * Wrap `client` so calls at any of the given method paths flow their response
 * through `extractUsage` / `streamUsage` → `ctx.record`. All non-listed
 * properties pass through transparently — the wrapped client is a drop-in
 * replacement.
 */
export function wrapByMethodPaths<T extends object>(
	client: T,
	specs: MethodSpec[],
	ctx: WrapContext,
): T {
	const root: Node = { children: new Map() };
	for (const spec of specs) {
		let node = root;
		for (const seg of spec.path) {
			let next = node.children.get(seg);
			if (!next) {
				next = { children: new Map() };
				node.children.set(seg, next);
			}
			node = next;
		}
		node.spec = spec;
	}
	return wrapNode(client, root, ctx) as T;
}

function wrapNode<U extends object>(
	target: U,
	node: Node,
	ctx: WrapContext,
): U {
	if (node.children.size === 0 && !node.spec) return target;
	return new Proxy(target, {
		get(t, prop, receiver) {
			const value = Reflect.get(t, prop, receiver);
			if (typeof prop !== "string") return value;
			const child = node.children.get(prop);
			if (!child) return value;

			if (child.spec && typeof value === "function") {
				return wrapCall(
					value as (...args: unknown[]) => unknown,
					t,
					child.spec,
					ctx,
				);
			}
			if (value && (typeof value === "object" || typeof value === "function")) {
				return wrapNode(value as object, child, ctx);
			}
			return value;
		},
	});
}

function wrapCall(
	fn: (...args: unknown[]) => unknown,
	thisArg: unknown,
	spec: MethodSpec,
	ctx: WrapContext,
): (...args: unknown[]) => unknown {
	return function wrapped(...args: unknown[]): unknown {
		let cleanArgs = args;
		let callContext: CallContext | undefined;
		if (spec.extractCallContext) {
			try {
				const extracted = spec.extractCallContext(args);
				cleanArgs = extracted.cleanArgs;
				callContext = extracted.context;
			} catch (err) {
				ctx.onError(
					err instanceof Error ? err : new Error(String(err)),
					"wrap",
				);
			}
		}

		// Provider failures must surface to the caller unchanged.
		const result: unknown = fn.apply(thisArg, cleanArgs);

		if (isThenable(result)) {
			return result.then((value) =>
				handleResolvedValue(value, spec, callContext, ctx),
			);
		}
		return handleResolvedValue(result, spec, callContext, ctx);
	};
}

function handleResolvedValue(
	value: unknown,
	spec: MethodSpec,
	callContext: CallContext | undefined,
	ctx: WrapContext,
): unknown {
	const wrappedStream = maybeWrapStream(value, spec, callContext, ctx);
	if (wrappedStream !== undefined) return wrappedStream;
	recordSafely(value, spec.extractUsage, callContext, ctx);
	return value;
}

/**
 * If `spec.streamUsage` is defined and `value` (or a field on it) is an async
 * iterable, return a wrapped form that intercepts chunks. Otherwise return
 * `undefined` so the caller falls through to the non-streaming `extractUsage`
 * path.
 */
function maybeWrapStream(
	value: unknown,
	spec: MethodSpec,
	callContext: CallContext | undefined,
	ctx: WrapContext,
): unknown {
	const su = spec.streamUsage;
	if (!su) return undefined;

	const handle = su.pickIterable ? su.pickIterable(value) : defaultPick(value);
	if (!handle) return undefined;

	const wrapped = createPassthroughIterable(
		handle.iterable,
		su,
		callContext,
		ctx,
	);
	return handle.rebuild(wrapped);
}

/**
 * Default `pickIterable`: if `value` is async-iterable, treat it as the
 * stream and rebuild via a Proxy that delegates non-iterator properties to
 * the original. This preserves things like OpenAI's `Stream.controller` and
 * `Stream.tee()` for callers who use them.
 */
function defaultPick(value: unknown): StreamHandle<unknown> | undefined {
	if (!isAsyncIterable(value)) return undefined;
	const original = value;
	return {
		iterable: value,
		rebuild: (wrapped) => proxyDelegateStream(original, wrapped),
	};
}

function proxyDelegateStream<T>(
	original: AsyncIterable<unknown> & object,
	wrapped: AsyncIterable<T>,
): unknown {
	return new Proxy(original, {
		get(target, prop, receiver) {
			if (prop === Symbol.asyncIterator) {
				return () => wrapped[Symbol.asyncIterator]();
			}
			return Reflect.get(target, prop, receiver);
		},
	});
}

/**
 * Build a passthrough async iterable that calls `onChunk` for each yielded
 * chunk and `finalize` + `ctx.record` exactly once after the stream ends
 * (whether by completion, consumer `return()`, or upstream error). Uses the
 * explicit iterator protocol so early termination is handled correctly.
 */
function createPassthroughIterable<Chunk>(
	source: AsyncIterable<Chunk>,
	su: StreamUsageSpec<Chunk>,
	callContext: CallContext | undefined,
	ctx: WrapContext,
): AsyncIterable<Chunk> {
	return {
		[Symbol.asyncIterator]() {
			const inner = source[Symbol.asyncIterator]();
			let acc: unknown = su.initial();
			let finalized = false;

			const finalize = () => {
				if (finalized) return;
				finalized = true;
				let usage: Partial<CanonicalUsage>;
				try {
					usage = (su.finalize as (acc: unknown) => Partial<CanonicalUsage>)(
						acc,
					);
				} catch (err) {
					ctx.onError(
						err instanceof Error ? err : new Error(String(err)),
						"extractUsage",
					);
					return;
				}
				if (!usage || hasNoUsage(usage)) return;
				try {
					ctx.record(usage, callContext);
				} catch (err) {
					ctx.onError(
						err instanceof Error ? err : new Error(String(err)),
						"record",
					);
				}
			};

			return {
				async next() {
					try {
						const r = await inner.next();
						if (r.done) {
							finalize();
						} else {
							try {
								acc = (su.onChunk as (chunk: Chunk, acc: unknown) => unknown)(
									r.value as Chunk,
									acc,
								);
							} catch (err) {
								ctx.onError(
									err instanceof Error ? err : new Error(String(err)),
									"extractUsage",
								);
							}
						}
						return r;
					} catch (err) {
						finalize();
						throw err;
					}
				},
				async return(value) {
					finalize();
					if (inner.return) return inner.return(value);
					return { done: true, value: value as Chunk };
				},
				async throw(err) {
					finalize();
					if (inner.throw) return inner.throw(err);
					throw err;
				},
				[Symbol.asyncIterator]() {
					return this;
				},
			};
		},
	};
}

function recordSafely(
	response: unknown,
	extractUsage: ExtractUsage,
	callContext: CallContext | undefined,
	ctx: WrapContext,
): void {
	let usage: Partial<CanonicalUsage>;
	try {
		usage = extractUsage(response);
	} catch (err) {
		ctx.onError(
			err instanceof Error ? err : new Error(String(err)),
			"extractUsage",
		);
		return;
	}
	if (!usage || hasNoUsage(usage)) return;
	try {
		ctx.record(usage, callContext);
	} catch (err) {
		ctx.onError(err instanceof Error ? err : new Error(String(err)), "record");
	}
}

function hasNoUsage(usage: Partial<CanonicalUsage>): boolean {
	for (const key of Object.keys(usage)) {
		const value = usage[key as keyof CanonicalUsage];
		if (typeof value === "number" && value > 0) return false;
	}
	return true;
}

function isThenable(value: unknown): value is Promise<unknown> {
	return (
		!!value &&
		(typeof value === "object" || typeof value === "function") &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

function isAsyncIterable(
	value: unknown,
): value is AsyncIterable<unknown> & object {
	return (
		!!value &&
		(typeof value === "object" || typeof value === "function") &&
		typeof (value as { [Symbol.asyncIterator]?: unknown })[
			Symbol.asyncIterator
		] === "function"
	);
}

/**
 * Helper for adapters whose calls take a single options object as the first
 * argument and want to support the `__chargebee` escape hatch. Strips the
 * field from a shallow clone of the options before forwarding.
 */
export function extractChargebeeFromOptions(args: unknown[]): {
	cleanArgs: unknown[];
	context?: CallContext;
} {
	if (args.length === 0 || !args[0] || typeof args[0] !== "object") {
		return { cleanArgs: args };
	}
	const first = args[0] as Record<string, unknown> & {
		__chargebee?: CallContext;
	};
	if (!first.__chargebee) return { cleanArgs: args };
	const { __chargebee, ...rest } = first;
	const context: CallContext = {
		subscriptionId: __chargebee.subscriptionId,
		properties: __chargebee.properties as EventProperties | undefined,
		usageTimestampMs: __chargebee.usageTimestampMs,
		requestId: __chargebee.requestId,
	};
	return { cleanArgs: [rest, ...args.slice(1)], context };
}
