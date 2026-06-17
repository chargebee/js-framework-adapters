import { randomUUID } from "node:crypto";

/**
 * Generate a stable deduplication ID for a usage event. If the caller supplied
 * a `requestId`, we derive a deterministic ID from it so retries are
 * idempotent. Otherwise we fall back to a UUID v4.
 */
export function deduplicationId(requestId: string | undefined): string {
	if (requestId && requestId.length > 0) {
		return `${requestId}`;
	}
	return `${randomUUID()}`;
}
