import {
	type Chargebee,
	raiseWarning,
	validateBasicAuth,
} from "@chargebee/nextjs";
import { type NextRequest, NextResponse } from "next/server.js";

export async function POST(req: NextRequest) {
	raiseWarning();
	// HTTP Basic Auth is currently optional when adding a new webhook
	// url in the Chargebee dashboard. However, we expect it's set by default.
	// Please set the env variable CHARGEBEE_WEBHOOK_BASIC_AUTH to "user:pass"
	// which is validated here
	try {
		validateBasicAuth(
			process.env.CHARGEBEE_WEBHOOK_AUTH,
			req.headers.get("authorization"),
		);
	} catch (error) {
		console.error(error);
		return NextResponse.error();
	}

	const data = (await req.json()) as Chargebee.Event;
	// TODO: handle the incoming webhook data
	console.log(data);
}
