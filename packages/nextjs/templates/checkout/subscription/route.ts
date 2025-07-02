import {
	client,
	createSubscriptionCheckout,
	raiseWarning,
	type SubscriptionInput,
} from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = createSubscriptionCheckout({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: async (req: NextRequest): Promise<SubscriptionInput> => {
		raiseWarning;
		const chargebee = await client.getFromEnv();
		// https://api-explorer.chargebee.com/item_prices/list_item_prices
		const { list } = await chargebee.itemPrice.list({
			limit: 1,
			item_type: {
				is: "plan",
			},
			status: {
				is: "active",
			},
		});

		return {
			subscription_items: [{ item_price_id: list[0]?.item_price.id }],
			redirect_url: `${req.nextUrl.origin}{{pathPrefix}}/checkout/callback`,
		} as SubscriptionInput;
	},
});
