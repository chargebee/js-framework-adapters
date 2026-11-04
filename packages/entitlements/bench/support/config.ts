/**
 * Benchmark flags, read from the environment:
 *
 *   pnpm bench:up
 *   REDIS_DELAY_MS=1 POSTGRES_DELAY_MS=3 CHARGEBEE_DELAY_MS=250 pnpm bench
 *   pnpm bench:down
 *
 * Redis and Postgres delays are added to every round trip by Toxiproxy.
 * The Chargebee delay is the mock API's response time.
 *
 * To benchmark real Redis and Postgres, set both (Toxiproxy is then skipped,
 * so the delay flags are rejected). The run flushes the Redis database and
 * truncates `entitlements_snapshot`, so point at a scratch Redis database:
 *
 *   REDIS_URL=redis://host:6379/1 POSTGRES_URL=postgres://... pnpm bench
 *
 * To hit a Chargebee test site instead of the mock, set both:
 *
 *   CHARGEBEE_SITE=acme-test CHARGEBEE_API_KEY=test_... pnpm bench
 *
 * The run first creates whatever `benchmark_*` fixtures the site lacks
 * (see bootstrap.ts). CHARGEBEE_DELAY_MS is ignored then.
 */

const DEFAULT_CHARGEBEE_DELAY_MS = 100;

// One customer per scenario, so scenarios can't disturb each other's snapshots.
export const CUSTOMER_COUNT = 5;

type ScenarioCustomerIds = [string, string, string, string, string];

export function customerId(index: number): string {
	return `benchmark_customer_${index}`;
}

export const CUSTOMER_IDS = Array.from({ length: CUSTOMER_COUNT }, (_, i) =>
	customerId(i + 1),
) as ScenarioCustomerIds;

function readString(name: string): string | undefined {
	const raw = process.env[name];
	return raw === undefined || raw === "" ? undefined : raw;
}

/** Credentials for a real Chargebee test site; absent means use the mock. */
function readLiveChargebee(): { site: string; apiKey: string } | undefined {
	const site = readString("CHARGEBEE_SITE");
	const apiKey = readString("CHARGEBEE_API_KEY");
	if (site === undefined && apiKey === undefined) {
		return undefined;
	}

	if (site === undefined || apiKey === undefined) {
		throw new Error("CHARGEBEE_SITE and CHARGEBEE_API_KEY must be set together");
	}

	return { site, apiKey };
}

function readDelayMs(name: string, fallback = 0): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") {
		return fallback;
	}

	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`${name} must be a non-negative number of milliseconds`);
	}

	return value;
}

export const REDIS_DELAY_MS = readDelayMs("REDIS_DELAY_MS");
export const POSTGRES_DELAY_MS = readDelayMs("POSTGRES_DELAY_MS");
export const CHARGEBEE_DELAY_MS = readDelayMs(
	"CHARGEBEE_DELAY_MS",
	DEFAULT_CHARGEBEE_DELAY_MS,
);

export const LIVE_CHARGEBEE = readLiveChargebee();

// Toxiproxy ports from docker-compose.yml.
export const TOXIPROXY_URL = "http://localhost:8474";
const DEFAULT_REDIS_URL = "redis://localhost:16379";
const DEFAULT_POSTGRES_URL =
	"postgres://postgres:postgres@localhost:15432/entitlements";

// An overridden URL bypasses Toxiproxy, so the delay flag can't apply to it.
function assertDelayable(
	urlName: string,
	delayName: string,
	delayMs: number,
): void {
	if (delayMs > 0 && readString(urlName) !== undefined) {
		throw new Error(`${delayName} can't be used with ${urlName}`);
	}
}

assertDelayable("REDIS_URL", "REDIS_DELAY_MS", REDIS_DELAY_MS);
assertDelayable("POSTGRES_URL", "POSTGRES_DELAY_MS", POSTGRES_DELAY_MS);

export const REDIS_PROXIED = readString("REDIS_URL") === undefined;
export const POSTGRES_PROXIED = readString("POSTGRES_URL") === undefined;
export const REDIS_URL = readString("REDIS_URL") ?? DEFAULT_REDIS_URL;
export const POSTGRES_URL =
	readString("POSTGRES_URL") ?? DEFAULT_POSTGRES_URL;

// Proxy names from toxiproxy.json.
export enum ProxyName {
	Redis = "redis",
	Postgres = "postgres",
}
