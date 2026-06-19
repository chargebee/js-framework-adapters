import type Chargebee from "chargebee";
import { describe, expect, it, vi } from "vitest";
import { ChargebeeEmitter } from "./emitter.js";
import { toError } from "./errors.js";
import type { ErrorSite, PendingUsageEvent } from "./types.js";

interface FakeChargebee {
	chargebee: Chargebee;
	calls: Array<{ events: PendingUsageEvent[] }>;
	queueResponse: (
		response: { failed_events?: unknown[] } | (() => never),
	) => void;
}

function fakeChargebee(): FakeChargebee {
	const calls: FakeChargebee["calls"] = [];
	const queue: Array<() => Promise<unknown> | unknown> = [];

	const chargebee = {
		usageEvent: {
			batchIngest: vi.fn(
				async ({ events }: { events: PendingUsageEvent[] }) => {
					calls.push({ events: events.slice() });
					const next = queue.shift();
					if (!next) return {};
					return next();
				},
			),
		},
	} as unknown as Chargebee;

	const queueResponse: FakeChargebee["queueResponse"] = (response) => {
		queue.push(() => {
			if (typeof response === "function") return response();
			return response;
		});
	};

	return { chargebee, calls, queueResponse };
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

describe("ChargebeeEmitter.send", () => {
	it("returns [] for an empty batch without calling Chargebee", async () => {
		const { chargebee, calls } = fakeChargebee();
		const { onError } = collectErrors();
		const emitter = new ChargebeeEmitter(chargebee, onError);
		expect(await emitter.send([])).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it("sends a single chunk when below the Chargebee ceiling", async () => {
		const { chargebee, calls, queueResponse } = fakeChargebee();
		queueResponse({});
		const { onError } = collectErrors();
		const emitter = new ChargebeeEmitter(chargebee, onError);
		const result = await emitter.send([event("a"), event("b"), event("c")]);
		expect(calls).toHaveLength(1);
		expect(calls[0].events).toHaveLength(3);
		expect(result).toEqual([]);
	});

	it("splits batches above the 500-event Chargebee ceiling", async () => {
		const { chargebee, calls, queueResponse } = fakeChargebee();
		queueResponse({});
		queueResponse({});
		queueResponse({});
		const { onError } = collectErrors();
		const emitter = new ChargebeeEmitter(chargebee, onError);
		const events: PendingUsageEvent[] = [];
		for (let i = 0; i < 1200; i++) events.push(event(`e${i}`));
		await emitter.send(events);
		expect(calls).toHaveLength(3);
		expect(calls[0].events).toHaveLength(500);
		expect(calls[1].events).toHaveLength(500);
		expect(calls[2].events).toHaveLength(200);
	});

	it("returns events for retry on a transient (5xx) failure", async () => {
		const { chargebee, queueResponse } = fakeChargebee();
		queueResponse(() => {
			throw toError({
				message: "service unavailable",
				http_status_code: 503,
			});
		});
		const { onError, errors } = collectErrors();
		const emitter = new ChargebeeEmitter(chargebee, onError);
		const events = [event("a"), event("b")];
		const toRetry = await emitter.send(events);
		expect(toRetry).toHaveLength(2);
		expect(toRetry.map((e) => e.deduplication_id)).toEqual(["a", "b"]);
		expect(errors).toHaveLength(1);
		expect(errors[0].where).toBe("batchIngest");
	});

	it("returns events for retry on a network error (no status code)", async () => {
		const { chargebee, queueResponse } = fakeChargebee();
		queueResponse(() => {
			throw new Error("ECONNRESET");
		});
		const { onError } = collectErrors();
		const emitter = new ChargebeeEmitter(chargebee, onError);
		const toRetry = await emitter.send([event("a")]);
		expect(toRetry).toHaveLength(1);
	});

	it("drops events permanently on UBB_BATCH_INGESTION_VALIDATION_ERROR", async () => {
		const { chargebee, queueResponse } = fakeChargebee();
		queueResponse(() => {
			throw toError({
				message: "validation failed",
				http_status_code: 400,
				api_error_code: "UBB_BATCH_INGESTION_VALIDATION_ERROR",
			});
		});
		const { onError, errors } = collectErrors();
		const emitter = new ChargebeeEmitter(chargebee, onError);
		const toRetry = await emitter.send([event("a"), event("b")]);
		expect(toRetry).toEqual([]);
		expect(errors).toHaveLength(1);
	});

	it("drops events on resource_not_found / invalid_request / api_auth* (all 4xx perms)", async () => {
		const codes = [
			"resource_not_found",
			"invalid_request",
			"api_authentication_failed",
			"api_authorization_failed",
		];
		for (const api_error_code of codes) {
			const { chargebee, queueResponse } = fakeChargebee();
			queueResponse(() => {
				throw toError({
					message: `permanent: ${api_error_code}`,
					http_status_code: 400,
					api_error_code,
				});
			});
			const { onError } = collectErrors();
			const emitter = new ChargebeeEmitter(chargebee, onError);
			expect(await emitter.send([event("a")])).toEqual([]);
		}
	});

	it("retries (does NOT drop) on 5xx even when api_error_code matches", async () => {
		const { chargebee, queueResponse } = fakeChargebee();
		queueResponse(() => {
			throw toError({
				message: "weird 5xx with perm code",
				http_status_code: 500,
				api_error_code: "invalid_request",
			});
		});
		const { onError } = collectErrors();
		const emitter = new ChargebeeEmitter(chargebee, onError);
		expect(await emitter.send([event("a")])).toHaveLength(1);
	});

	it("returns only failed events when Chargebee reports partial success", async () => {
		const { chargebee, queueResponse } = fakeChargebee();
		queueResponse({
			failed_events: [{ deduplication_id: "b", error_msg: "bad subscription" }],
		});
		const { onError } = collectErrors();
		const emitter = new ChargebeeEmitter(chargebee, onError);
		const toRetry = await emitter.send([event("a"), event("b"), event("c")]);
		expect(toRetry.map((e) => e.deduplication_id)).toEqual(["b"]);
	});

	it("returns the full chunk when failed_events exists but matches nothing (defensive)", async () => {
		const { chargebee, queueResponse } = fakeChargebee();
		queueResponse({ failed_events: [{ no_id: true }] });
		const { onError } = collectErrors();
		const emitter = new ChargebeeEmitter(chargebee, onError);
		const toRetry = await emitter.send([event("a"), event("b")]);
		expect(toRetry).toHaveLength(2);
	});

	it("treats failed_events as success when the array is empty or missing", async () => {
		const { chargebee, queueResponse } = fakeChargebee();
		queueResponse({});
		queueResponse({ failed_events: [] });
		const { onError } = collectErrors();
		const emitter = new ChargebeeEmitter(chargebee, onError);
		expect(await emitter.send([event("a")])).toEqual([]);
		expect(await emitter.send([event("b")])).toEqual([]);
	});

	it("invokes onError exactly once per failed chunk (single log per attempt)", async () => {
		const { chargebee, queueResponse } = fakeChargebee();
		queueResponse(() => {
			throw new Error("transient");
		});
		const { onError, errors } = collectErrors();
		const emitter = new ChargebeeEmitter(chargebee, onError);
		await emitter.send([event("a"), event("b")]);
		expect(errors).toHaveLength(1);
	});
});
