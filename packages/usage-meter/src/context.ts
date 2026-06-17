import { AsyncLocalStorage } from "node:async_hooks";
import type { CallContext, EventProperties } from "./types.js";

/**
 * Per-async-context call overrides. Resolution order in {@link resolveContext}
 * is: per-call → context → meter default.
 */
export class ContextStore {
	private readonly storage = new AsyncLocalStorage<CallContext>();

	get(): CallContext | undefined {
		return this.storage.getStore();
	}

	run<R>(ctx: CallContext, fn: () => R): R {
		const parent = this.storage.getStore();
		const merged = parent ? mergeContext(parent, ctx) : ctx;
		return this.storage.run(merged, fn);
	}
}

/** Merge two contexts; `child` wins on conflict, properties are shallow-merged. */
export function mergeContext(
	base: CallContext,
	child: CallContext,
): CallContext {
	const properties: EventProperties | undefined =
		base.properties || child.properties
			? { ...(base.properties ?? {}), ...(child.properties ?? {}) }
			: undefined;
	return {
		subscriptionId: child.subscriptionId ?? base.subscriptionId,
		properties,
		usageTimestampMs: child.usageTimestampMs ?? base.usageTimestampMs,
		requestId: child.requestId ?? base.requestId,
	};
}
