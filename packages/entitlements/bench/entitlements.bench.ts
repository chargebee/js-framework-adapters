import { afterAll, beforeAll, test } from "vitest";
import type {
	ChargebeeTarget,
	EntitlementDetails,
	EntitlementStatus,
	SnapshotSource,
} from "../src/shared";
import { LIVE_SEATS_FEATURE_ID } from "./support/bootstrap";
import {
	CHARGEBEE_DELAY_MS,
	CUSTOMER_IDS,
	LIVE_CHARGEBEE,
	POSTGRES_DELAY_MS,
	REDIS_DELAY_MS,
} from "./support/config";
import { BenchStack } from "./support/stack";

const FEATURE_ID = LIVE_CHARGEBEE ? LIVE_SEATS_FEATURE_ID : "licensed-seats";
const DEFAULT_SEATS = 0;

// Each scenario owns a target, so interleaved iterations can't disturb each other.
const [CACHE_HIT_ID, STORE_HIT_ID, BLOCKING_MISS_ID, BACKGROUND_MISS_ID, FROM_API_ID] =
	CUSTOMER_IDS;
const CACHE_HIT: ChargebeeTarget = { customerId: CACHE_HIT_ID };
const STORE_HIT: ChargebeeTarget = { customerId: STORE_HIT_ID };
const BLOCKING_MISS: ChargebeeTarget = { customerId: BLOCKING_MISS_ID };
const BACKGROUND_MISS: ChargebeeTarget = { customerId: BACKGROUND_MISS_ID };
const FROM_API: ChargebeeTarget = { customerId: FROM_API_ID };

// `bench.compare` interleaves iterations, so a time budget would make fast
// scenarios wait on slow ones. Fixed counts keep runs bounded instead.
const STORED_RUN = {
	time: 0,
	iterations: 200,
	warmupTime: 0,
	warmupIterations: 20,
};
const MISSING_RUN = {
	time: 0,
	iterations: 50,
	warmupTime: 0,
	warmupIterations: 3,
};
const TIMEOUT_MS = 5 * 60 * 1000;

const CHARGEBEE_LABEL = LIVE_CHARGEBEE
	? `chargebee ${LIVE_CHARGEBEE.site}`
	: `chargebee ${CHARGEBEE_DELAY_MS}ms`;
const LATENCY = `redis +${REDIS_DELAY_MS}ms, postgres +${POSTGRES_DELAY_MS}ms, ${CHARGEBEE_LABEL}`;

let stack: BenchStack;

// Covers first-run fixture creation on a real site.
beforeAll(async () => {
	stack = await BenchStack.start();
}, TIMEOUT_MS);

afterAll(async () => {
	await stack?.close();
});

/** Fails the run when a scenario took a different path than it claims to measure. */
function expectPath(
	details: EntitlementDetails<number>,
	status: EntitlementStatus,
	source?: SnapshotSource,
): void {
	if (details.status === status && details.source === source) {
		return;
	}

	throw new Error(
		`Expected ${status}/${source}, got ${details.status}/${details.source}`,
	);
}

test(
	`snapshot stored (${LATENCY})`,
	{ timeout: TIMEOUT_MS },
	async ({ bench }) => {
		await bench.compare(
			// Redis GET.
			bench(
				"cache hit: Redis",
				{ beforeAll: () => stack.prime(CACHE_HIT) },
				async () => {
					const details = await stack.blocking.getDetails(
						FEATURE_ID,
						DEFAULT_SEATS,
						CACHE_HIT,
					);
					expectPath(details, "granted", "cache");
				},
			),

			// Redis GET miss, Postgres SELECT, Redis SET backfill.
			bench(
				"store hit: Redis miss, Postgres",
				{
					beforeAll: () => stack.prime(STORE_HIT),
					beforeEach: () => stack.evictCache(STORE_HIT),
				},
				async () => {
					const details = await stack.blocking.getDetails(
						FEATURE_ID,
						DEFAULT_SEATS,
						STORE_HIT,
					);
					expectPath(details, "granted", "store");
				},
			),

			STORED_RUN,
		);
	},
);

test(
	`snapshot missing (${LATENCY})`,
	{ timeout: TIMEOUT_MS },
	async ({ bench }) => {
		let refreshed: Promise<void> = Promise.resolve();

		await bench.compare(
			// Redis and Postgres miss, Chargebee, Postgres upsert, Redis SET.
			bench(
				"cold miss, blocking: Chargebee",
				{ beforeEach: () => stack.forget(BLOCKING_MISS) },
				async () => {
					const details = await stack.blocking.getDetails(
						FEATURE_ID,
						DEFAULT_SEATS,
						BLOCKING_MISS,
					);
					expectPath(details, "granted", "api");
				},
			),

			// Redis and Postgres miss, answers `pending`; Chargebee runs untimed.
			bench(
				"cold miss, background: pending",
				{
					beforeEach: async () => {
						await stack.forget(BACKGROUND_MISS);
						refreshed = stack.nextRefresh();
					},
					afterEach: () => refreshed,
				},
				async () => {
					const details = await stack.background.getDetails(
						FEATURE_ID,
						DEFAULT_SEATS,
						BACKGROUND_MISS,
					);
					expectPath(details, "pending");
				},
			),

			// Chargebee, Postgres upsert, Redis DEL; skips both reads.
			bench("getFromAPI: Chargebee", async () => {
				const seats = await stack.blocking.getFromAPI(
					FEATURE_ID,
					DEFAULT_SEATS,
					FROM_API,
				);
				if (seats === DEFAULT_SEATS) {
					throw new Error("getFromAPI fell back to the default");
				}
			}),

			MISSING_RUN,
		);
	},
);
