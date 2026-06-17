import type { ErrorSite } from "./types.js";

/**
 * Default `onError` implementation. Prints a single-line warning to stderr so
 * misconfigured environments still surface the issue, but never throws.
 *
 * Set `CHARGEBEE_USAGE_METER_DEBUG=1` (or `=full`) to also dump the raw error
 * object via `console.dir`, useful when the upstream SDK throws something
 * unusual that the one-line formatter can't fully describe.
 */
export function defaultOnError(err: Error, where: ErrorSite): void {
	console.error(`[chargebee/usage-meter] ${where}: ${formatError(err)}`);
	if (process.env.CHARGEBEE_USAGE_METER_DEBUG) {
		console.dir(err, { depth: 5, colors: false });
	}
}

/**
 * Coerce any thrown value into an `Error` instance while preserving the
 * original fields. The Chargebee SDK (and many fetch-based clients) sometimes
 * reject with the raw HTTP response body — a plain object with rich fields
 * like `message`, `api_error_code`, `http_status_code`, etc. Wrapping that in
 * `new Error(String(raw))` produces the infamous `"[object Object]"` and
 * throws away the diagnostic data; this helper preserves it.
 */
export function toError(raw: unknown): Error {
	if (raw instanceof Error) return raw;
	if (raw && typeof raw === "object") {
		const r = raw as Record<string, unknown>;
		const message =
			pickString(r.message) ??
			pickString(r.error_msg) ??
			pickString(r.error) ??
			pickString(r.error_description) ??
			"(no message)";
		const error = new Error(message);
		// Preserve every original field so formatError can surface them
		// (api_error_code, http_status_code, type, headers, failed_events, ...).
		for (const key of Object.keys(r)) {
			if (key === "message") continue;
			try {
				(error as unknown as Record<string, unknown>)[key] = r[key];
			} catch {
				// Some keys (e.g. read-only inherited ones) can throw on assign — skip.
			}
		}
		return error;
	}
	return new Error(String(raw));
}

function pickString(v: unknown): string | undefined {
	if (typeof v !== "string") return undefined;
	if (v.length === 0) return undefined;
	if (v === "[object Object]") return undefined;
	return v;
}

/**
 * Build a single-line description of an error that's useful regardless of
 * whether the caller threw a stock `Error`, a Chargebee `ChargebeeError`, or
 * a plain object payload.
 *
 * Strategy: pull `name` + `message`, then enumerate every own property
 * (including non-enumerable ones — `Error.message` is non-enumerable by
 * default, and Chargebee adds enumerable fields like `http_status_code`).
 * If we still have nothing useful, fall back to the constructor name plus a
 * full property dump.
 */
export function formatError(err: unknown): string {
	if (err == null) return String(err);
	if (typeof err !== "object") return String(err);
	const e = err as Record<string, unknown> & { name?: string; cause?: unknown };

	const parts: string[] = [];

	const name =
		typeof e.name === "string" && e.name && e.name !== "Error" ? e.name : "";
	const message =
		typeof e.message === "string" && e.message !== "[object Object]"
			? e.message
			: "";
	if (name && message) parts.push(`${name}: ${message}`);
	else if (message) parts.push(message);
	else if (name) parts.push(name);

	const meta = collectMeta(e);
	if (meta) parts.push(`(${meta})`);

	if (parts.length === 0) {
		// Last-resort: dump everything we can see. Includes non-enumerable own
		// props (e.g. Error.message left at its default empty string).
		const dump = dumpOwnProps(e);
		const ctor =
			(e.constructor as { name?: string } | undefined)?.name ?? "object";
		return Object.keys(dump).length > 0
			? `${ctor} ${safeJson(dump)}`
			: `${ctor} (no fields)`;
	}

	if (e.cause) parts.push(`caused by: ${formatError(e.cause)}`);
	return parts.join(" ");
}

function collectMeta(e: Record<string, unknown>): string {
	const keys = [
		["status", "http_status_code"],
		["http_code", "http_code"],
		["code", "api_error_code"],
		["type", "type"],
		["param", "param"],
		["error_code", "error_code"],
		["detail", "detail"],
	] as const;
	const out: string[] = [];
	for (const [label, key] of keys) {
		const v = e[key];
		if (v === undefined || v === null || v === "") continue;
		out.push(`${label}=${typeof v === "string" ? v : safeJson(v)}`);
	}
	return out.join(" ");
}

function dumpOwnProps(e: object): Record<string, unknown> {
	const dump: Record<string, unknown> = {};
	for (const key of Object.getOwnPropertyNames(e)) {
		if (key === "stack") continue;
		const v = (e as Record<string, unknown>)[key];
		if (v === undefined || typeof v === "function") continue;
		dump[key] = v;
	}
	return dump;
}

function safeJson(v: unknown): string {
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
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
		onError(toError(err), where);
		return fallback;
	}
}
