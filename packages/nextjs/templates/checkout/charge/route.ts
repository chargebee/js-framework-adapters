import { type ChargeInput, charge } from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = charge({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: (_req: NextRequest): ChargeInput => {
		return {} as ChargeInput;
	},
});
