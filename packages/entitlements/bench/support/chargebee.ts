import Chargebee, { type HttpClientInterface } from "chargebee";

/**
 * Chargebee SDK whose HTTP round trip is replaced by a canned one-page
 * response after `delayMs`. Every customer is on the same plan.
 */
export function createMockChargebee(delayMs: number): Chargebee {
	const httpClient: HttpClientInterface = {
		async makeApiRequest() {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
			return Response.json({
				list: PLAN.map((row) => ({ customer_entitlement: row })),
			});
		},
	};

	return new Chargebee({ site: "bench", apiKey: "bench", httpClient });
}

const PLAN = [
	{
		feature_id: "advanced-reports",
		feature_name: "Advanced reports",
		feature_type: "switch",
		value: "true",
		is_enabled: true,
	},
	{
		feature_id: "licensed-seats",
		feature_name: "Licensed seats",
		feature_type: "quantity",
		feature_unit: "seat",
		value: "25",
		is_enabled: true,
	},
	{
		feature_id: "api-calls",
		feature_name: "API calls per month",
		feature_type: "range",
		value: "unlimited",
		is_enabled: true,
	},
	{
		feature_id: "support-tier",
		feature_name: "Support tier",
		feature_type: "custom",
		value: "priority",
		is_enabled: true,
	},
];
