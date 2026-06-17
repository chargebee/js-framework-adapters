import type { ChargebeeEmitter } from "./emitter.js";
import type { ErrorSite, PendingUsageEvent } from "./types.js";

export interface BatcherOptions {
	flushIntervalMs: number;
	maxBatchSize: number;
	maxBufferSize: number;
	maxRetryMs: number;
	onError: (err: Error, where: ErrorSite) => void;
}

/**
 * In-memory ring buffer + background flusher. Producers (`enqueue`) never
 * block; if the buffer is full the oldest event is dropped and the loss is
 * reported via `onError`.
 *
 * Flushes happen on three triggers:
 *  - periodic timer (`flushIntervalMs`)
 *  - buffer reaches `maxBatchSize`
 *  - explicit `flush()`
 *
 * Failures retry with full-jitter exponential backoff capped at `maxRetryMs`.
 */
export class Batcher {
	private readonly buffer: PendingUsageEvent[] = [];
	private timer: NodeJS.Timeout | undefined;
	private flushInFlight: Promise<void> | undefined;
	private retryDelayMs = 0;
	private stopped = false;

	constructor(
		private readonly emitter: ChargebeeEmitter,
		private readonly opts: BatcherOptions,
	) {}

	start(): void {
		if (this.stopped) return;
		if (this.timer) return;
		this.timer = setInterval(() => {
			void this.flush();
		}, this.opts.flushIntervalMs);
		// In Node, unref the timer so it doesn't keep the process alive.
		this.timer.unref?.();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	enqueue(event: PendingUsageEvent): void {
		if (this.buffer.length >= this.opts.maxBufferSize) {
			const dropped = this.buffer.shift();
			if (dropped) {
				this.opts.onError(
					new Error(
						`buffer overflow: dropped event ${dropped.deduplication_id}`,
					),
					"record",
				);
			}
		}
		this.buffer.push(event);
		if (this.buffer.length >= this.opts.maxBatchSize) {
			void this.flush();
		}
	}

	bufferedCount(): number {
		return this.buffer.length;
	}

	/**
	 * Drain the buffer. Concurrent callers share a single in-flight flush so we
	 * never send the same event twice. Safe to call from `SIGTERM` handlers.
	 */
	async flush(): Promise<void> {
		if (this.flushInFlight) return this.flushInFlight;
		this.flushInFlight = this.drain().finally(() => {
			this.flushInFlight = undefined;
		});
		return this.flushInFlight;
	}

	private async drain(): Promise<void> {
		while (this.buffer.length > 0) {
			const chunk = this.buffer.splice(0, this.opts.maxBatchSize);
			const toRetry = await this.emitter.send(chunk);
			if (toRetry.length > 0) {
				// Put failed events back at the head of the queue so order is roughly
				// preserved, and wait out the backoff before the next attempt.
				this.buffer.unshift(...toRetry);
				this.bumpBackoff();
				await sleep(this.retryDelayMs);
				if (this.stopped) return;
			} else {
				this.retryDelayMs = 0;
			}
		}
	}

	private bumpBackoff(): void {
		const next = this.retryDelayMs === 0 ? 250 : this.retryDelayMs * 2;
		const capped = Math.min(next, this.opts.maxRetryMs);
		// Full jitter — random between [capped/2, capped].
		this.retryDelayMs = Math.round(capped / 2 + Math.random() * (capped / 2));
	}
}

function sleep(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => {
		const t = setTimeout(resolve, ms);
		t.unref?.();
	});
}
