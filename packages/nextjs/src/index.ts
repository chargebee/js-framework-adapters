import { type NextRequest, NextResponse } from "next/server.js";
import {
	type ChargeRequest,
	checkout,
	type ManageRequest,
	type PortalCreateRequest,
	portal,
	type SubscriptionRequest,
} from "#core";

export * from "#core";

const userAgentSuffix = "Next v1.0.0-beta.1";

export const createOneTimeCheckout = ({
	apiKey,
	site,
	apiPayload,
}: ChargeRequest) => {
	return async (req: NextRequest) => {
		try {
			const payload = await apiPayload(req);
			const { hosted_page } = await checkout.oneTime(
				{ apiKey, site, userAgentSuffix },
				payload,
			);
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

export const createSubscriptionCheckout = ({
	apiKey,
	site,
	apiPayload,
}: SubscriptionRequest) => {
	return async (req: NextRequest) => {
		try {
			const payload = await apiPayload(req);
			const { hosted_page } = await checkout.subscription(
				{
					apiKey,
					site,
					userAgentSuffix,
				},
				payload,
			);
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

export const managePaymentSources = ({
	apiKey,
	site,
	apiPayload,
}: ManageRequest) => {
	return async (req: NextRequest) => {
		try {
			const payload = await apiPayload(req);
			const { hosted_page } = await checkout.manage(
				{
					apiKey,
					site,
					userAgentSuffix,
				},
				payload,
			);
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

export const createPortalSession = ({
	apiKey,
	site,
	apiPayload,
}: PortalCreateRequest) => {
	return async (req: NextRequest) => {
		try {
			const payload = await apiPayload(req);
			const { portal_session } = await portal.create(
				{
					apiKey,
					site,
					userAgentSuffix,
				},
				payload,
			);
			if (portal_session.access_url) {
				return NextResponse.redirect(portal_session.access_url);
			} else {
				throw new Error(`Could not generate URL for portal session`);
			}
		} catch (err) {
			console.error(err);
			return NextResponse.error();
		}
	};
};
