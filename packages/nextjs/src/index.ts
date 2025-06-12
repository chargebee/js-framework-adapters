import { type NextRequest, NextResponse } from "next/server.js";
import {
	type ChargeRequest,
	checkout,
	type ManageRequest,
	type SubscriptionRequest,
} from "#core";

export * from "#core";

export const charge = ({ apiKey, site, apiPayload }: ChargeRequest) => {
	return async (req: NextRequest) => {
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

export const subscribe = ({
	apiKey,
	site,
	apiPayload,
}: SubscriptionRequest) => {
	return async (req: NextRequest) => {
		try {
			const payload = await apiPayload(req);
			const { hosted_page } = await checkout.subscribe({
				apiKey,
				site,
				payload,
			});
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

export const manage = ({ apiKey, site, apiPayload }: ManageRequest) => {
	return async (req: NextRequest) => {
		try {
			const payload = await apiPayload(req);
			const { hosted_page } = await checkout.managePayment({
				apiKey,
				site,
				payload,
			});
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
