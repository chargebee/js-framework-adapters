import { type ManageInput, managePaymentSources } from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = managePaymentSources({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: (req: NextRequest): ManageInput => {
		console.warn(
			`⚠ This is the default implementation from chargebee-init and must be reviewed!`,
		);
		// https://apidocs.chargebee.com/docs/api/hosted_pages?lang=node#manage_payment_sources
		return {
			customer: {
				id: "chargebee-customer-id",
				redirect_url: `${req.nextUrl.origin}/{{pathPrefix}}/checkout/callback`,
				pass_thru_content: crypto.randomUUID(),
			},
		} as ManageInput;
	},
});
