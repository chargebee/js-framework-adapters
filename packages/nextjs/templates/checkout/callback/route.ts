import { client } from "@chargebee/nextjs";
import type { NextRequest } from "next/server.js";

export const GET = async (req: NextRequest) => {
	console.warn(
		`⚠ This is the default implementation from chargebee-init and must be reviewed!`,
	);
	const id = req.nextUrl.searchParams.get("id");
	const state = req.nextUrl.searchParams.get("state");
	// TODO: validate state and do something with the hosted page id
	const chargebee = await client.getFromEnv();
	if (state === "succeeded") {
		const { hosted_page } = await chargebee.hostedPage.retrieve(id!);
	}
};
