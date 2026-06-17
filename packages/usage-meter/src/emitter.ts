import type Chargebee from "chargebee";
import type { ErrorSite, PendingUsageEvent } from "./types.js";

/** Chargebee's documented hard ceiling for `usageEvent.batchIngest`. */
export const CHARGEBEE_BATCH_CEILING = 500;

/**
 * Thin wrapper around `chargebee.usageEvent.batchIngest`. Splits batches above
 * {@link CHARGEBEE_BATCH_CEILING} and surfaces partial failures via `onError`.
 */
export class ChargebeeEmitter {
	constructor(
		private readonly chargebee: Chargebee,
		private readonly onError: (err: Error, where: ErrorSite) => void,
	) {}

	/**
	 * Send a batch of events. Resolves once all sub-batches have been attempted.
	 * Returns the set of events that should be retried (failed events from
	 * Chargebee's response).
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
			this.onError(
				err instanceof Error ? err : new Error(String(err)),
				"batchIngest",
			);
			return chunk;
		}
	}
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
