/**
 * Benchmark flags, read from the environment:
 *
 *   pnpm bench:up
 *   REDIS_DELAY_MS=1 POSTGRES_DELAY_MS=3 CHARGEBEE_DELAY_MS=250 pnpm bench
 *   pnpm bench:down
 *
 * Redis and Postgres delays are added to every round trip by Toxiproxy.
 * The Chargebee delay is the mock API's response time.
 */

const DEFAULT_CHARGEBEE_DELAY_MS = 500;

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

// Toxiproxy ports from docker-compose.yml.
export const TOXIPROXY_URL = "http://localhost:8474";
export const REDIS_URL = "redis://localhost:16379";
export const POSTGRES_URL =
	"postgres://postgres:postgres@localhost:15432/entitlements";

// Proxy names from toxiproxy.json.
export enum ProxyName {
	Redis = "redis",
	Postgres = "postgres",
}
