import { type Chargebee, validateBasicAuth } from "chargebee-init-core";
import type { Application, Request, Response } from "express";

const prefix = `chargebee`;

async function charge(req: Request, res: Response) {}

async function manage(req: Request, res: Response) {}

async function subscribe(req: Request, res: Response) {}

async function webhook(req: Request, _res: Response) {
	// HTTP Basic Auth is currently optional when adding a new webhook
	// url in the Chargebee dashboard. However, we expect it's set by default.
	// Please set the env variable CHARGEBEE_WEBHOOK_BASIC_AUTH to "user:pass"
	// which is validated here
	try {
		validateBasicAuth(
			process.env.CHARGEBEE_WEBHOOK_AUTH,
			req.get("authorization"),
		);
	} catch (error) {
		console.error(error);
	}

	const data = req.body as Chargebee.Event;
	// TODO: handle the incoming webhook data
	console.log(data);
}

export function init(app: Application) {
	// Checkout
	app.get(`/${prefix}/checkout/charge`, charge);
	app.get(`/${prefix}/checkout/manage`, manage);
	app.get(`/${prefix}/checkout/subscribe`, subscribe);

	// Webhook
	app.post(`/${prefix}/webhook`, webhook);

	return app;
}

module.exports = init;
