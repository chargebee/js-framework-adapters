import { charge } from "@chargebee/nextjs";
import { type ChargeInput, parseQueryString } from "chargebee-init-core";
import type { NextRequest } from "next/server.js";

export const GET = charge({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: (req: NextRequest): ChargeInput => {
		const queryParams = parseQueryString(req.nextUrl);
		return queryParams as ChargeInput;
	},
});
