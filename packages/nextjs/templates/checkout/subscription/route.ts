import { subscribe } from "@chargebee/nextjs";
import { parseQueryString, type SubscriptionInput } from "chargebee-init-core";
import type { NextRequest } from "next/server.js";

export const GET = subscribe({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: (req: NextRequest): SubscriptionInput => {
		const queryParams = parseQueryString(req.nextUrl);
		return queryParams as SubscriptionInput;
	},
});
