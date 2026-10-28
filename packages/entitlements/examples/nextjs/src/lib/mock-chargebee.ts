import type { HttpClientInterface } from "chargebee";

/**
 * Answers Chargebee API calls with canned data when `.env` has no
 * credentials. The real SDK still builds every request; only the HTTP round
 * trip is replaced:
 *
 *   ChargebeeEntitlements ─► chargebee SDK ─► mockHttpClient ─► canned JSON
 */

const LATENCY_MS = 300;
const HTTP_NOT_FOUND = 404;
const CUSTOMER_ENTITLEMENTS_PATH =
	/\/customers\/([^/]+)\/customer_entitlements$/;

/** An entitlement row as the Chargebee API returns it. */
interface RawEntitlement {
	feature_id: string;
	feature_name: string;
	feature_type: "switch" | "quantity" | "range" | "custom";
	feature_unit?: string;
	value: string;
	is_enabled: boolean;
}

const PRO_PLAN: RawEntitlement[] = [
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

/** No `support-tier` row, so that feature resolves to its default. */
const FREE_PLAN: RawEntitlement[] = [
	{
		feature_id: "advanced-reports",
		feature_name: "Advanced reports",
		feature_type: "switch",
		value: "false",
		is_enabled: false,
	},
	{
		feature_id: "licensed-seats",
		feature_name: "Licensed seats",
		feature_type: "quantity",
		feature_unit: "seat",
		value: "3",
		is_enabled: true,
	},
	{
		feature_id: "api-calls",
		feature_name: "API calls per month",
		feature_type: "range",
		value: "1000",
		is_enabled: true,
	},
];

/** Any other customer ID gets a 404, like a customer missing from the site. */
const CUSTOMERS: Record<string, RawEntitlement[]> = {
	cust_pro: PRO_PLAN,
	cust_free: FREE_PLAN,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chargebee's error body for an unknown resource. */
function notFound(message: string): Response {
	return Response.json(
		{
			message,
			type: "invalid_request",
			api_error_code: "resource_not_found",
			http_status_code: HTTP_NOT_FOUND,
		},
		{ status: HTTP_NOT_FOUND },
	);
}

export const mockHttpClient: HttpClientInterface = {
	async makeApiRequest(request) {
		const { pathname } = new URL(request.url);
		console.log(`[mock chargebee] ${request.method} ${pathname}`);
		await sleep(LATENCY_MS);

		const match = CUSTOMER_ENTITLEMENTS_PATH.exec(pathname);
		if (!match?.[1]) {
			return notFound(`No mock for ${pathname}`);
		}

		const customerId = decodeURIComponent(match[1]);
		const entitlements = CUSTOMERS[customerId];
		if (!entitlements) {
			return notFound(`Customer ${customerId} not found`);
		}

		// One page: no `next_offset`.
		return Response.json({
			list: entitlements.map((row) => ({ customer_entitlement: row })),
		});
	},
};
