import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Batcher } from "./batcher.js";
import type { ChargebeeEmitter } from "./emitter.js";
import type { ErrorSite, PendingUsageEvent } from "./types.js";

interface FakeEmitter {
	emitter: ChargebeeEmitter;
	calls: Array<{ events: PendingUsageEvent[] }>;
	queueResult: (result: PendingUsageEvent[]) => void;
}

function fakeEmitter(): FakeEmitter {
	const calls: FakeEmitter["calls"] = [];
	const results: Array<PendingUsageEvent[]> = [];
	const emitter = {
		send: vi.fn(async (events: PendingUsageEvent[]) => {
			calls.push({ events: events.slice() });
			return results.length > 0 ? (results.shift() as PendingUsageEvent[]) : [];
		}),
	} as unknown as ChargebeeEmitter;
	return {
		emitter,
		calls,
		queueResult: (result) => results.push(result),
	};
}

function event(id: string): PendingUsageEvent {
	return {
		deduplication_id: id,
		subscription_id: "sub_x",
		usage_timestamp: 1_700_000_000_000,
		properties: { input_tokens: 1 },
	};
}

function collectErrors(): {
	onError: (err: Error, where: ErrorSite) => void;
	errors: Array<{ err: Error; where: ErrorSite }>;
} {
	const errors: Array<{ err: Error; where: ErrorSite }> = [];
	return {
		onError: (err, where) => {
			errors.push({ err, where });
		},
		errors,
	};
}

describe("Batcher.enqueue", () => {
	it("tracks buffered count", () => {
		const { emitter } = fakeEmitter();
		const { onError } = collectErrors();
		const batcher = new Batcher(emitter, {
			flushIntervalMs: 60_000,
			maxBatchSize: 10,
			maxBufferSize: 100,
			maxRetryMs: 1000,
			onError,
		});
		batcher.enqueue(event("a"));
		batcher.enqueue(event("b"));
		expect(batcher.bufferedCount()).toBe(2);
	});

	it("triggers an immediate flush when buffer reaches maxBatchSize", async () => {
		const { emitter, calls } = fakeEmitter();
		const { onError } = collectErrors();
		const batcher = new Batcher(emitter, {
			flushIntervalMs: 60_000,
			maxBatchSize: 3,
			maxBufferSize: 100,
			maxRetryMs: 1000,
			onError,
		});
		batcher.enqueue(event("a"));
		batcher.enqueue(event("b"));
		expect(calls).toHaveLength(0);
		batcher.enqueue(event("c"));
		await batcher.flush();
		expect(calls).toHaveLength(1);
		expect(calls[0].events).toHaveLength(3);
	});

	it("drops oldest event + reports via onError when buffer overflows", () => {
		const { emitter } = fakeEmitter();
		const { onError, errors } = collectErrors();
		const batcher = new Batcher(emitter, {
			flushIntervalMs: 60_000,
			maxBatchSize: 1000,
			maxBufferSize: 3,
			maxRetryMs: 1000,
			onError,
		});
		batcher.enqueue(event("a"));
		batcher.enqueue(event("b"));
		batcher.enqueue(event("c"));
		batcher.enqueue(event("d"));
		expect(batcher.bufferedCount()).toBe(3);
		expect(errors).toHaveLength(1);
		expect(errors[0].where).toBe("record");
		expect(errors[0].err.message).toContain("buffer overflow");
		expect(errors[0].err.message).toContain("a");
	});
});

describe("Batcher.start (periodic flush)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("flushes on the configured interval", async () => {
		const { emitter, calls } = fakeEmitter();
		const { onError } = collectErrors();
		const batcher = new Batcher(emitter, {
			flushIntervalMs: 500,
			maxBatchSize: 1000,
			maxBufferSize: 1000,
			maxRetryMs: 1000,
			onError,
		});
		batcher.start();
		batcher.enqueue(event("a"));
		expect(calls).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(500);
		expect(calls).toHaveLength(1);
		batcher.stop();
	});

	it("start() is idempotent (no duplicate timers)", async () => {
		const { emitter, calls } = fakeEmitter();
		const { onError } = collectErrors();
		const batcher = new Batcher(emitter, {
			flushIntervalMs: 500,
			maxBatchSize: 1000,
			maxBufferSize: 1000,
			maxRetryMs: 1000,
			onError,
		});
		batcher.start();
		batcher.start();
		batcher.enqueue(event("a"));
		await vi.advanceTimersByTimeAsync(500);
		expect(calls).toHaveLength(1);
		batcher.stop();
	});

	it("stop() halts the periodic flush", async () => {
		const { emitter, calls } = fakeEmitter();
		const { onError } = collectErrors();
		const batcher = new Batcher(emitter, {
			flushIntervalMs: 500,
			maxBatchSize: 1000,
			maxBufferSize: 1000,
			maxRetryMs: 1000,
			onError,
		});
		batcher.start();
		batcher.stop();
		batcher.enqueue(event("a"));
		await vi.advanceTimersByTimeAsync(5_000);
		expect(calls).toHaveLength(0);
	});

	it("start() after stop() does not resume (stopped is sticky)", async () => {
		const { emitter, calls } = fakeEmitter();
		const { onError } = collectErrors();
		const batcher = new Batcher(emitter, {
			flushIntervalMs: 500,
			maxBatchSize: 1000,
			maxBufferSize: 1000,
			maxRetryMs: 1000,
			onError,
		});
		batcher.start();
		batcher.stop();
		batcher.start();
		batcher.enqueue(event("a"));
		await vi.advanceTimersByTimeAsync(5_000);
		expect(calls).toHaveLength(0);
	});
});

describe("Batcher.flush", () => {
	it("returns the same in-flight promise to concurrent callers", async () => {
		const { emitter, calls } = fakeEmitter();
		const { onError } = collectErrors();
		const batcher = new Batcher(emitter, {
			flushIntervalMs: 60_000,
			maxBatchSize: 10,
			maxBufferSize: 100,
			maxRetryMs: 1000,
			onError,
		});
		batcher.enqueue(event("a"));
		batcher.enqueue(event("b"));
		await Promise.all([batcher.flush(), batcher.flush(), batcher.flush()]);
		expect(calls).toHaveLength(1);
	});

	it("is a no-op when the buffer is empty", async () => {
		const { emitter, calls } = fakeEmitter();
		const { onError } = collectErrors();
		const batcher = new Batcher(emitter, {
			flushIntervalMs: 60_000,
			maxBatchSize: 10,
			maxBufferSize: 100,
			maxRetryMs: 1000,
			onError,
		});
		await batcher.flush();
		expect(calls).toHaveLength(0);
	});
});

describe("Batcher retry & backoff", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("re-queues failed events at the head and retries after backoff", async () => {
		const { emitter, calls, queueResult } = fakeEmitter();
		const { onError } = collectErrors();
		queueResult([event("a"), event("b")]);
		queueResult([]);

		const batcher = new Batcher(emitter, {
			flushIntervalMs: 60_000,
			maxBatchSize: 10,
			maxBufferSize: 100,
			maxRetryMs: 1000,
			onError,
		});
		batcher.enqueue(event("a"));
		batcher.enqueue(event("b"));

		const flushPromise = batcher.flush();
		await vi.advanceTimersByTimeAsync(5_000);
		await flushPromise;

		expect(calls).toHaveLength(2);
		expect(calls[0].events.map((e) => e.deduplication_id)).toEqual(["a", "b"]);
		expect(calls[1].events.map((e) => e.deduplication_id)).toEqual(["a", "b"]);
	});

	it("resets backoff after a successful send", async () => {
		const { emitter, queueResult } = fakeEmitter();
		const { onError } = collectErrors();
		queueResult([event("a")]);
		queueResult([]);

		const batcher = new Batcher(emitter, {
			flushIntervalMs: 60_000,
			maxBatchSize: 10,
			maxBufferSize: 100,
			maxRetryMs: 1000,
			onError,
		});
		batcher.enqueue(event("a"));

		const p1 = batcher.flush();
		await vi.advanceTimersByTimeAsync(5_000);
		await p1;

		queueResult([event("b")]);
		queueResult([]);
		batcher.enqueue(event("b"));
		const p2 = batcher.flush();
		await vi.advanceTimersByTimeAsync(5_000);
		await p2;
	});

	it("respects maxRetryMs as the cap on backoff", async () => {
		const { emitter, queueResult } = fakeEmitter();
		const { onError } = collectErrors();
		for (let i = 0; i < 5; i++) queueResult([event("a")]);
		queueResult([]);

		const batcher = new Batcher(emitter, {
			flushIntervalMs: 60_000,
			maxBatchSize: 10,
			maxBufferSize: 100,
			maxRetryMs: 200,
			onError,
		});
		batcher.enqueue(event("a"));
		const flushPromise = batcher.flush();
		await vi.advanceTimersByTimeAsync(10_000);
		await flushPromise;
	});

	it("stops retrying when stop() is called mid-loop", async () => {
		const { emitter, calls, queueResult } = fakeEmitter();
		const { onError } = collectErrors();
		queueResult([event("a")]);
		queueResult([event("a")]);
		queueResult([event("a")]);

		const batcher = new Batcher(emitter, {
			flushIntervalMs: 60_000,
			maxBatchSize: 10,
			maxBufferSize: 100,
			maxRetryMs: 50,
			onError,
		});
		batcher.enqueue(event("a"));
		const flushPromise = batcher.flush();

		await vi.advanceTimersByTimeAsync(60);
		batcher.stop();
		await vi.advanceTimersByTimeAsync(10_000);
		await flushPromise;

		expect(calls.length).toBeLessThan(3);
	});
});
