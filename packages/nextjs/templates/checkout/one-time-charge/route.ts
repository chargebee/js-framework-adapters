import { type ChargeInput, createOneTimeCheckout } from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = createOneTimeCheckout({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: (req: NextRequest): ChargeInput => {
		// TODO: return a ChargeInput
		return {
			// TODO: Get the item price id from the defualt chargbee test site
			item_prices: [{ item_price_id: "cbdemo_one-time-setup-fee" }],
			redirect_url: `${req.nextUrl.origin}/chargebee/checkout/callback`,
			pass_thru_content: crypto.randomUUID(),
		} as ChargeInput;
	},
});
