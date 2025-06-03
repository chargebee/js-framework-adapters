import { charge, manage, subscribe } from "@chargebee/express";
import {
	type Chargebee,
	type ChargeInput,
	type ManageInput,
	parseQueryString,
	type SubscriptionInput,
	validateBasicAuth,
} from "chargebee-init-core";
import type { Application, Request, Response } from "express";

const apiKey = process.env.CHARGEBEE_API_KEY!;
const site = process.env.CHARGEBEE_SITE!;
const webhookBasicAuth = process.env.CHARGEBEE_WEBHOOK_AUTH;

const routePrefix = `chargebee`;

const chargeController = charge({
	apiKey,
	site,
	apiPayload: (req: Request) => {
		const queryParams = parseQueryString(new URL(req.url));
		return queryParams as ChargeInput;
	},
});

const subscribeController = subscribe({
	apiKey,
	site,
	apiPayload: (req: Request) => {
		const queryParams = parseQueryString(new URL(req.url));
		return queryParams as SubscriptionInput;
	},
});

const manageController = manage({
	apiKey,
	site,
	apiPayload: (req: Request) => {
		const queryParams = parseQueryString(new URL(req.url));
		return queryParams as ManageInput;
	},
});

async function webhook(req: Request, _res: Response) {
	// HTTP Basic Auth is currently optional when adding a new webhook
	// url in the Chargebee dashboard. However, we expect it's set by default.
	// Please set the env variable CHARGEBEE_WEBHOOK_BASIC_AUTH to "user:pass"
	// which is validated here
	try {
		validateBasicAuth(webhookBasicAuth, req.get("authorization"));
	} catch (error) {
		console.error(error);
	}

	const data = req.body as Chargebee.Event;
	// TODO: handle the incoming webhook data
	console.log(data);
}

export function init(app: Application) {
	// Checkout
	app.get(`/${routePrefix}/checkout/charge`, chargeController);
	app.get(`/${routePrefix}/checkout/manage`, manageController);
	app.get(`/${routePrefix}/checkout/subscribe`, subscribeController);

	// Webhook
	app.post(`/${routePrefix}/webhook`, webhook);

	return app;
}

module.exports = init;
