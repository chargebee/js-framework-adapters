import { type ManageInput, manage } from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = manage({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: (req: NextRequest): ManageInput => {
		return {
			customer: {
				id: "chargebee-customer-id",
				redirect_url: `${req.nextUrl.origin}/chargebee/checkout/callback`,
				pass_thru_content: crypto.randomUUID(),
			},
		} as ManageInput;
	},
});
