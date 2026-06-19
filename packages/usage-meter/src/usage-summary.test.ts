import type Chargebee from "chargebee";
import { describe, expect, it, vi } from "vitest";
import type { ErrorSite } from "./types.js";
import { UsageSummaryClient } from "./usage-summary.js";

function fakeChargebee(
	impl: (
		id: string,
		opts: Record<string, unknown>,
	) => Promise<unknown> | unknown,
): {
	chargebee: Chargebee;
	calls: Array<{ id: string; opts: Record<string, unknown> }>;
} {
	const calls: Array<{ id: string; opts: Record<string, unknown> }> = [];
	const chargebee = {
		usageSummary: {
			retrieveUsageSummaryForSubscription: vi.fn(
				async (id: string, opts: Record<string, unknown>) => {
					calls.push({ id, opts });
					return impl(id, opts);
				},
			),
		},
	} as unknown as Chargebee;
	return { chargebee, calls };
}

function noopOnError(_err: Error, _where: ErrorSite): void {}

describe("UsageSummaryClient.get", () => {
	it("forwards every input field with the right Chargebee snake_case keys", async () => {
		const { chargebee, calls } = fakeChargebee(() => ({ list: [] }));
		const client = new UsageSummaryClient(chargebee, noopOnError);
		await client.get({
			subscriptionId: "sub_acme",
			featureId: "feat_llm_tokens",
			windowSize: "month",
			timeframeStart: 1700,
			timeframeEnd: 1800,
			limit: 50,
			offset: "tok_xyz",
		});
		expect(calls[0]).toEqual({
			id: "sub_acme",
			opts: {
				feature_id: "feat_llm_tokens",
				window_size: "month",
				timeframe_start: 1700,
				timeframe_end: 1800,
				limit: 50,
				offset: "tok_xyz",
			},
		});
	});

	it("maps Chargebee's list shape onto UsageSummaryEntry[]", async () => {
		const { chargebee } = fakeChargebee(() => ({
			list: [
				{
					usage_summary: {
						subscription_id: "sub_a",
						feature_id: "feat_x",
						aggregated_value: "12345",
						aggregated_from: 1000,
						aggregated_to: 2000,
					},
				},
				{
					usage_summary: {
						subscription_id: "sub_a",
						feature_id: "feat_y",
						aggregated_value: "67",
						aggregated_from: 1000,
						aggregated_to: 2000,
					},
				},
			],
			next_offset: "tok_next",
		}));
		const client = new UsageSummaryClient(chargebee, noopOnError);
		const page = await client.get({
			subscriptionId: "sub_a",
			featureId: "feat_x",
		});
		expect(page.items).toEqual([
			{
				subscriptionId: "sub_a",
				featureId: "feat_x",
				aggregatedValue: "12345",
				aggregatedFrom: 1000,
				aggregatedTo: 2000,
			},
			{
				subscriptionId: "sub_a",
				featureId: "feat_y",
				aggregatedValue: "67",
				aggregatedFrom: 1000,
				aggregatedTo: 2000,
			},
		]);
		expect(page.nextOffset).toBe("tok_next");
	});

	it("returns an empty page when list is missing", async () => {
		const { chargebee } = fakeChargebee(() => ({}));
		const client = new UsageSummaryClient(chargebee, noopOnError);
		const page = await client.get({
			subscriptionId: "sub_a",
			featureId: "feat_x",
		});
		expect(page.items).toEqual([]);
		expect(page.nextOffset).toBeUndefined();
	});

	it("reports errors via onError and rethrows", async () => {
		const errors: Array<{ err: Error; where: ErrorSite }> = [];
		const { chargebee } = fakeChargebee(() => {
			throw { message: "not found", http_status_code: 404 };
		});
		const client = new UsageSummaryClient(chargebee, (err, where) => {
			errors.push({ err, where });
		});
		await expect(
			client.get({ subscriptionId: "sub_a", featureId: "feat_x" }),
		).rejects.toBeTruthy();
		expect(errors).toHaveLength(1);
		expect(errors[0].where).toBe("getUsageSummary");
		expect(errors[0].err.message).toBe("not found");
		expect(
			(errors[0].err as unknown as Record<string, unknown>).http_status_code,
		).toBe(404);
	});

	it("does not crash when optional fields are absent", async () => {
		const { chargebee, calls } = fakeChargebee(() => ({ list: [] }));
		const client = new UsageSummaryClient(chargebee, noopOnError);
		await client.get({ subscriptionId: "sub_a", featureId: "feat_x" });
		expect(calls[0].opts).toEqual({
			feature_id: "feat_x",
			window_size: undefined,
			timeframe_start: undefined,
			timeframe_end: undefined,
			limit: undefined,
			offset: undefined,
		});
	});
});
