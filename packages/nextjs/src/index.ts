import { type ChargeRequest, checkout } from "chargebee-init-core";
import type { NextMiddlewareResult } from "next/dist/server/web/types.js";
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
			const payload = await apiPayload(req);
			const { hosted_page } = await checkout.charge({ apiKey, site, payload });
			if (hosted_page.url) {
				return NextResponse.redirect(hosted_page.url);
			} else {
				throw new Error(`Could not generate URL for checkout`);
			}
		} catch (err) {
			console.error(err);
			return NextResponse.error();
		}
	};
};
