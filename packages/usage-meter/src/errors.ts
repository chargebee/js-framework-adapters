import type { ErrorSite } from "./types.js";

/**
 * Default `onError` implementation. Prints a single-line warning to stderr so
 * misconfigured environments still surface the issue, but never throws.
 */
export function defaultOnError(err: Error, where: ErrorSite): void {
	const message = err instanceof Error ? err.message : String(err);
	console.error(`[chargebee/usage-meter] ${where}: ${message}`);
}

/**
 * Wrap a sync operation so it can never throw out to the caller; any error is
 * routed to `onError` and the fallback is returned instead.
 */
export function safeSync<T>(
	fn: () => T,
	onError: (err: Error, where: ErrorSite) => void,
	where: ErrorSite,
	fallback: T,
): T {
	try {
		return fn();
	} catch (err) {
		onError(err instanceof Error ? err : new Error(String(err)), where);
		return fallback;
	}
}
