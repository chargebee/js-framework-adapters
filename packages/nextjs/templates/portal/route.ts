import { createPortalSession, type PortalCreateInput } from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = createPortalSession({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: (req: NextRequest): PortalCreateInput => {
		// TODO: return a PortalCreateInput
		return {
			customer: {
				id: "169zdpUhwKN6C9AU",
			},
			redirect_url: `${req.nextUrl.origin}/users/`,
		} as PortalCreateInput;
	},
});
