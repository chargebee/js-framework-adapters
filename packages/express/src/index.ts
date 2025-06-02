import {
	type ChargeRequest,
	checkout,
	type ManageRequest,
	type SubscriptionRequest,
} from "chargebee-init-core";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export const charge = ({
	apiKey,
	site,
	apiPayload,
}: ChargeRequest): RequestHandler => {
	return async (req: Request, res: Response, next: NextFunction) => {
		try {
			const payload = await apiPayload(req);
			const { hosted_page } = await checkout.charge({ apiKey, site, payload });
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

export const subscribe = ({
	apiKey,
	site,
	apiPayload,
}: SubscriptionRequest): RequestHandler => {
	return async (req: Request, res: Response, next: NextFunction) => {
		try {
			const payload = await apiPayload(req);
			const { hosted_page } = await checkout.subscribe({
				apiKey,
				site,
				payload,
			});
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

export const manage = ({
	apiKey,
	site,
	apiPayload,
}: ManageRequest): RequestHandler => {
	return async (req: Request, res: Response, next: NextFunction) => {
		try {
			const payload = await apiPayload(req);
			const { hosted_page } = await checkout.managePayment({
				apiKey,
				site,
				payload,
			});
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
