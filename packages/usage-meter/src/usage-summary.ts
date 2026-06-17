import type Chargebee from "chargebee";
import type { ErrorSite } from "./types.js";

/** A pre-aggregated usage window for a single feature on a subscription. */
export interface UsageSummaryEntry {
	subscriptionId: string;
	featureId: string;
	/** Stringified number, as returned by Chargebee. */
	aggregatedValue: string;
	/** Window start (Unix seconds). */
	aggregatedFrom: number;
	/** Window end (Unix seconds). */
	aggregatedTo: number;
}

export interface GetUsageSummaryInput {
	subscriptionId: string;
	/** Chargebee metered feature id (from the feature you created in Step 1). */
	featureId: string;
	windowSize?: "month" | "week" | "day" | "hour" | "minute";
	/** Inclusive lower bound (Unix seconds). */
	timeframeStart?: number;
	/** Exclusive upper bound (Unix seconds). */
	timeframeEnd?: number;
	limit?: number;
	offset?: string;
}

export interface UsageSummaryPage {
	items: UsageSummaryEntry[];
	nextOffset?: string;
}

/**
 * Thin typed wrapper around
 * `chargebee.usageSummary.retrieveUsageSummaryForSubscription`. Lets callers
 * fetch pre-aggregated usage for dashboards, pre-flight quota checks, etc.
 */
export class UsageSummaryClient {
	constructor(
		private readonly chargebee: Chargebee,
		private readonly onError: (err: Error, where: ErrorSite) => void,
	) {}

	async get(input: GetUsageSummaryInput): Promise<UsageSummaryPage> {
		try {
			const response =
				await this.chargebee.usageSummary.retrieveUsageSummaryForSubscription(
					input.subscriptionId,
					{
						feature_id: input.featureId,
						window_size: input.windowSize,
						timeframe_start: input.timeframeStart,
						timeframe_end: input.timeframeEnd,
						limit: input.limit,
						offset: input.offset,
					},
				);
			return {
				items: (response.list ?? []).map((row) => ({
					subscriptionId: row.usage_summary.subscription_id,
					featureId: row.usage_summary.feature_id,
					aggregatedValue: row.usage_summary.aggregated_value,
					aggregatedFrom: row.usage_summary.aggregated_from,
					aggregatedTo: row.usage_summary.aggregated_to,
				})),
				nextOffset: response.next_offset,
			};
		} catch (err) {
			this.onError(
				err instanceof Error ? err : new Error(String(err)),
				"getUsageSummary",
			);
			throw err;
		}
	}
}
