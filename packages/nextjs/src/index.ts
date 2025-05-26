import type { ChargeRequest } from "chargebee-init-core";
import Chargebee from "chargebee";
import { NextMiddlewareResult } from "next/dist/server/web/types.js";
import {
	type NextMiddleware,
	type NextRequest,
	NextResponse,
} from "next/server.js";

export const charge = ({
	apiKey,
	site,
	apiPayload,
}: ChargeRequest): NextMiddleware => {
	return async (req: NextRequest): Promise<NextMiddlewareResult> => {
		try {
			const chargebee = new Chargebee({ apiKey, site });
			const payload = await apiPayload(req);
			const { hosted_page } =
				await chargebee.hostedPage.checkoutOneTimeForItems(payload);
			return NextResponse.redirect(hosted_page.url!);
		} catch (err) {
			console.error(err);
			return NextResponse.error();
		}
	};
};
