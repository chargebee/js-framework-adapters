import {
	createPortalSession,
	type PortalCreateInput,
	raiseWarning,
} from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = createPortalSession({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: async (req: NextRequest): Promise<PortalCreateInput> => {
		raiseWarning();
		// TODO: Return the authenticated customer here
		return {
			customer: {
				id: "",
			},
			redirect_url: `${req.nextUrl.origin}/users/`,
		} as PortalCreateInput;
	},
});
