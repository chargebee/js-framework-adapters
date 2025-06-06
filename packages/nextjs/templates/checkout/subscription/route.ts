import { type SubscriptionInput, subscribe } from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = subscribe({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: (_req: NextRequest): SubscriptionInput => {
		return {} as SubscriptionInput;
	},
});
