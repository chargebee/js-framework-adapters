import type Chargebee from "chargebee";
import { toError } from "./errors.js";
import type { ErrorSite, PendingUsageEvent } from "./types.js";

/** Chargebee's documented hard ceiling for `usageEvent.batchIngest`. */
export const CHARGEBEE_BATCH_CEILING = 500;

/**
 * Chargebee `api_error_code` values that signal a **permanent** validation
 * failure — retrying the same payload accomplishes nothing. We surface once
 * via `onError`, then drop the chunk so the buffer doesn't spin.
 */
const PERMANENT_VALIDATION_CODES = new Set([
	"UBB_BATCH_INGESTION_VALIDATION_ERROR",
	"resource_not_found",
	"invalid_request",
	"api_authentication_failed",
	"api_authorization_failed",
]);

/**
 * Thin wrapper around `chargebee.usageEvent.batchIngest`. Splits batches above
 * {@link CHARGEBEE_BATCH_CEILING} and surfaces partial failures via `onError`.
 *
 * Two failure modes are handled differently:
 *  - **Transient** (network, 5xx, throttling) — events are returned for the
 *    batcher to retry with exponential backoff.
 *  - **Permanent validation** (4xx with a known validation code) — events are
 *    dropped after one `onError` call.
 */
export class ChargebeeEmitter {
	constructor(
		private readonly chargebee: Chargebee,
		private readonly onError: (err: Error, where: ErrorSite) => void,
	) {}

	/**
	 * Send a batch of events. Resolves once all sub-batches have been attempted.
	 * Returns the events that should be retried.
	 */
	async send(events: PendingUsageEvent[]): Promise<PendingUsageEvent[]> {
		if (events.length === 0) return [];

		const toRetry: PendingUsageEvent[] = [];
		for (let i = 0; i < events.length; i += CHARGEBEE_BATCH_CEILING) {
			const chunk = events.slice(i, i + CHARGEBEE_BATCH_CEILING);
			const failed = await this.sendChunk(chunk);
			toRetry.push(...failed);
		}
		return toRetry;
	}

	private async sendChunk(
		chunk: PendingUsageEvent[],
	): Promise<PendingUsageEvent[]> {
		try {
			const response = await this.chargebee.usageEvent.batchIngest({
				events: chunk,
			});
			const failed = response?.failed_events;
			if (!Array.isArray(failed) || failed.length === 0) return [];
			return matchFailedEvents(chunk, failed);
		} catch (err) {
			const error = toError(err);
			this.onError(error, "batchIngest");
			return isPermanentValidationError(error) ? [] : chunk;
		}
	}
}

/**
 * Returns true when the SDK threw a 4xx with one of the known permanent
 * validation codes. Both `api_error_code` and `error_code` are checked
 * because Chargebee surfaces the code in either field depending on endpoint.
 */
function isPermanentValidationError(err: Error): boolean {
	const e = err as unknown as Record<string, unknown>;
	const status =
		typeof e.http_status_code === "number"
			? e.http_status_code
			: typeof e.http_code === "number"
				? e.http_code
				: undefined;
	if (status !== undefined && (status < 400 || status >= 500)) return false;
	const codes = [e.api_error_code, e.error_code].filter(
		(c): c is string => typeof c === "string",
	);
	return codes.some((c) => PERMANENT_VALIDATION_CODES.has(c));
}

/**
 * Chargebee's `failed_events` payload echoes the original event plus an error
 * envelope. We match on `deduplication_id` to find the pending events that
 * need re-queuing.
 */
function matchFailedEvents(
	chunk: PendingUsageEvent[],
	failed: unknown[],
): PendingUsageEvent[] {
	const failedIds = new Set<string>();
	for (const f of failed) {
		if (f && typeof f === "object") {
			const id = (f as { deduplication_id?: unknown }).deduplication_id;
			if (typeof id === "string") failedIds.add(id);
		}
	}
	if (failedIds.size === 0) return chunk.slice();
	return chunk.filter((event) => failedIds.has(event.deduplication_id));
}
