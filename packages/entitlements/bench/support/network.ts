import { type ProxyName, TOXIPROXY_URL } from "./config";

const TOXIC_NAME = "latency";
const HTTP_NOT_FOUND = 404;

async function toxiproxy(path: string, init?: RequestInit): Promise<Response> {
	const response = await fetch(`${TOXIPROXY_URL}${path}`, init);
	if (response.ok || response.status === HTTP_NOT_FOUND) {
		return response;
	}

	throw new Error(
		`Toxiproxy ${init?.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`,
	);
}

/**
 * Delays every response from `proxy` by `delayMs`, so each round trip pays
 * it once, like a cloud network hop. 0 removes the delay.
 */
export async function setLatency(
	proxy: ProxyName,
	delayMs: number,
): Promise<void> {
	await toxiproxy(`/proxies/${proxy}/toxics/${TOXIC_NAME}`, {
		method: "DELETE",
	});

	if (delayMs === 0) {
		return;
	}

	await toxiproxy(`/proxies/${proxy}/toxics`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: TOXIC_NAME,
			type: "latency",
			stream: "downstream",
			toxicity: 1,
			attributes: { latency: delayMs, jitter: 0 },
		}),
	});
}
