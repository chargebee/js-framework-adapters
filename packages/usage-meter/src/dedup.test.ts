import { describe, expect, it } from "vitest";
import { deduplicationId } from "./dedup.js";

describe("deduplicationId", () => {
	it("returns the request id verbatim when supplied (idempotent retries)", () => {
		expect(deduplicationId("req_abc_123")).toBe("req_abc_123");
		expect(deduplicationId("req_abc_123")).toBe("req_abc_123");
	});

	it("does NOT prefix with cb-usage-meter: (regression)", () => {
		expect(deduplicationId("req_abc")).not.toMatch(/^cb-usage-meter:/);
		expect(deduplicationId(undefined)).not.toMatch(/^cb-usage-meter:/);
		expect(deduplicationId("")).not.toMatch(/^cb-usage-meter:/);
	});

	it("falls back to a UUID for missing / empty request ids", () => {
		const a = deduplicationId(undefined);
		const b = deduplicationId("");
		expect(a).toMatch(/^[0-9a-f-]{36}$/);
		expect(b).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("generates unique ids across calls when no request id is given", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 1000; i++) ids.add(deduplicationId(undefined));
		expect(ids.size).toBe(1000);
	});
});
