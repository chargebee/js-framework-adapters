import {
	type ChargeInput,
	client,
	createOneTimeCheckout,
} from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = createOneTimeCheckout({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: async (req: NextRequest): Promise<ChargeInput> => {
		console.warn(
			`⚠ This is the default implementation from chargebee-init and must be reviewed!`,
		);
		const chargebee = await client.getFromEnv();
		// https://api-explorer.chargebee.com/item_prices/list_item_prices
		const { list } = await chargebee.itemPrice.list({
			item_type: {
				is: "charge",
			},
			status: {
				is: "active",
			},
		});

		return {
			item_prices: list.map((entry) => ({
				item_price_id: entry.item_price.id,
			})),
			redirect_url: `${req.nextUrl.origin}/{{pathPrefix}}/checkout/callback`,
		} as ChargeInput;
	},
});
