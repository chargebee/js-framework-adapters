import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
	type ChargeRequest,
	checkout,
	type ManageRequest,
	type PortalCreateRequest,
	portal,
	type SubscriptionRequest,
} from "#core";

export * from "#core";

const userAgentSuffix = "Express v1.0.0";

export const createOneTimeCheckout = ({
	apiKey,
	site,
	apiPayload,
}: ChargeRequest): RequestHandler => {
	return async (req: Request, res: Response, next: NextFunction) => {
		try {
			const payload = await apiPayload(req);
			const { hosted_page } = await checkout.oneTime(
				{ apiKey, site, userAgentSuffix },
				payload,
			);
			if (hosted_page.url) {
				return res.redirect(hosted_page.url);
			} else {
				throw new Error(`Could not generate URL for checkout`);
			}
		} catch (err) {
			console.error(err);
			next(err);
		}
	};
};

export const createSubscriptionCheckout = ({
	apiKey,
	site,
	apiPayload,
}: SubscriptionRequest): RequestHandler => {
	return async (req: Request, res: Response, next: NextFunction) => {
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
				return res.redirect(hosted_page.url);
			} else {
				throw new Error(`Could not generate URL for checkout`);
			}
		} catch (err) {
			console.error(err);
			next(err);
		}
	};
};

export const managePaymentSources = ({
	apiKey,
	site,
	apiPayload,
}: ManageRequest): RequestHandler => {
	return async (req: Request, res: Response, next: NextFunction) => {
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
				return res.redirect(hosted_page.url);
			} else {
				throw new Error(`Could not generate URL for checkout`);
			}
		} catch (err) {
			console.error(err);
			next(err);
		}
	};
};

export const createPortalSession = ({
	apiKey,
	site,
	apiPayload,
}: PortalCreateRequest) => {
	return async (req: Request, res: Response, next: NextFunction) => {
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
				return res.redirect(portal_session.access_url);
			} else {
				throw new Error(`Could not generate URL for portal session`);
			}
		} catch (err) {
			console.error(err);
			next(err);
		}
	};
};
