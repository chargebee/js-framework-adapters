import {
	createSubscriptionCheckout,
	type SubscriptionInput,
} from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = createSubscriptionCheckout({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: (req: NextRequest): SubscriptionInput => {
		return {
			subscription_items: [{ item_price_id: "cbdemo_business-suite-annual" }],
			redirect_url: `${req.nextUrl.origin}/chargebee/checkout/callback`,
			pass_thru_content: crypto.randomUUID(),
		} as SubscriptionInput;
	},
});
