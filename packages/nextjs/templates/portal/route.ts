import { createPortalSession, type PortalCreateInput } from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = createPortalSession({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: async (req: NextRequest): Promise<PortalCreateInput> => {
		console.warn(
			`⚠ This is the default implementation from chargebee-init and must be reviewed!`,
		);
		// TODO: Return the authenticated customer here
		return {
			customer: {
				id: "",
			},
			redirect_url: `${req.nextUrl.origin}/users/`,
		} as PortalCreateInput;
	},
});
