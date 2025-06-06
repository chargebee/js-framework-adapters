import { type ManageInput, manage } from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = manage({
	apiKey: process.env.CHARGEBEE_API_KEY!,
	site: process.env.CHARGEBEE_SITE!,
	apiPayload: (_req: NextRequest): ManageInput => {
		return {} as ManageInput;
	},
});
