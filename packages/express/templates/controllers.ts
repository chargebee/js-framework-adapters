import {
	type Chargebee,
	type ChargeInput,
	client,
	createOneTimeCheckout,
	createPortalSession,
	createSubscriptionCheckout,
	type ManageInput,
	managePaymentSources,
	type PortalCreateInput,
	type SubscriptionInput,
	validateBasicAuth,
} from "@chargebee/express";
import type { Application, Request, Response } from "express";

const apiKey = process.env.CHARGEBEE_API_KEY!;
const site = process.env.CHARGEBEE_SITE!;
const webhookBasicAuth = process.env.CHARGEBEE_WEBHOOK_AUTH;

const chargeController = createOneTimeCheckout({
	apiKey,
	site,
	apiPayload: (_req: Request) => {
		return {} as ChargeInput;
	},
});

const subscribeController = createSubscriptionCheckout({
	apiKey,
	site,
	apiPayload: (_req: Request) => {
		return {} as SubscriptionInput;
	},
});

const manageController = managePaymentSources({
	apiKey,
	site,
	apiPayload: (_req: Request) => {
		return {} as ManageInput;
	},
});

const portalController = createPortalSession({
	apiKey,
	site,
	apiPayload: (_req: Request) => {
		return {} as PortalCreateInput;
	},
});

async function callbackController(req: Request, _res: Response) {
	const { searchParams } = new URL(req.originalUrl);
	const id = searchParams.get("id");
	const state = searchParams.get("state");
	// TODO: validate state and do something with the hosted page id
	const chargebee = await client.getFromEnv();
	if (state === "succeeded") {
		const { hosted_page } = await chargebee.hostedPage.retrieve(id!);
	}
}

async function webhookController(req: Request, _res: Response) {
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

export default function init(
	app: Application,
	{ routePrefix = "/chargebee" } = {} as { routePrefix: string },
) {
	// Checkout
	app.get(`${routePrefix}/checkout/one-time-charge`, chargeController);
	app.get(`${routePrefix}/checkout/subscription`, subscribeController);
	app.get(`${routePrefix}/checkout/manage-payment-sources`, manageController);
	app.get(`${routePrefix}/checkout/callback`, callbackController);

	// Portal
	app.get(`${routePrefix}/portal`, portalController);

	// Webhook
	app.post(`/${routePrefix}/webhook`, webhookController);

	return app;
}

// Usage:
// import chargebeeInit from "./chargebee/controllers.ts"
// chargebeeInit(app);
