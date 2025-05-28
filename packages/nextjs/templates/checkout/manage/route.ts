import { manage } from "@chargebee/nextjs";
import { type ManageInput, parseQueryString } from "chargebee-init-core";
import type { NextRequest } from "next/server.js";

export const GET = manage({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: (req: NextRequest): ManageInput => {
		const queryParams = parseQueryString(req.nextUrl);
		return queryParams as ManageInput;
	},
});
