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

/**
 * Checkout an item without creating a subscription
 */
const chargeController = createOneTimeCheckout({
	apiKey,
	site,
	apiPayload: async (req: Request) => {
		console.warn(
			`⚠ This is the default implementation from chargebee-init and must be reviewed!`,
		);
		const chargebee = await client.getFromEnv();
		// https://api-explorer.chargebee.com/item_prices/list_item_prices
		const { list } = await chargebee.itemPrice.list({
			item_type: {
				is: "charge",
			},
			status: {
				is: "active",
			},
		});

		return {
			item_prices: list.map((entry) => ({
				item_price_id: entry.item_price.id,
			})),
			redirect_url: `${req.baseUrl}/{{pathPrefix}}/checkout/callback`,
		} as ChargeInput;
	},
});

/**
 * Create a subscription
 */
const subscriptionController = createSubscriptionCheckout({
	apiKey,
	site,
	apiPayload: async (req: Request) => {
		console.warn(
			`⚠ This is the default implementation from chargebee-init and must be reviewed!`,
		);
		const chargebee = await client.getFromEnv();
		// https://api-explorer.chargebee.com/item_prices/list_item_prices
		const { list } = await chargebee.itemPrice.list({
			limit: 1,
			item_type: {
				is: "plan",
			},
			status: {
				is: "active",
			},
		});

		return {
			subscription_items: [{ item_price_id: list[0]?.item_price.id }],
			redirect_url: `${req.baseUrl}/{{pathPrefix}}/checkout/callback`,
		} as SubscriptionInput;
	},
});

/**
 * Let the customer add/remove payment sources
 */
const manageController = managePaymentSources({
	apiKey,
	site,
	apiPayload: async (req: Request) => {
		console.warn(
			`⚠ This is the default implementation from chargebee-init and must be reviewed!`,
		);
		// https://apidocs.chargebee.com/docs/api/hosted_pages?lang=node#manage_payment_sources
		return {
			customer: {
				id: "chargebee-customer-id",
				redirect_url: `${req.baseUrl}/{{pathPrefix}}/checkout/callback`,
				pass_thru_content: crypto.randomUUID(),
			},
		} as ManageInput;
	},
});

/**
 * Open the Chargebee portal for the given cutomer ID
 */
const portalController = createPortalSession({
	apiKey,
	site,
	apiPayload: async (req: Request) => {
		console.warn(
			`⚠ This is the default implementation from chargebee-init and must be reviewed!`,
		);
		// TODO: Return the authenticated customer here
		return {
			customer: {
				id: "chargebee-customer-id",
			},
			redirect_url: `${req.baseUrl}/users/`,
		} as PortalCreateInput;
	},
});

/**
 * Checkout callback function
 */
async function callbackController(req: Request, _res: Response) {
	console.warn(
		`⚠ This is the default implementation from chargebee-init and must be reviewed!`,
	);
	const { searchParams } = new URL(req.originalUrl);
	const id = searchParams.get("id");
	const state = searchParams.get("state");
	// TODO: validate state and do something with the hosted page id
	const chargebee = await client.getFromEnv();
	if (state === "succeeded") {
		const { hosted_page } = await chargebee.hostedPage.retrieve(id!);
	}
}

/**
 * Handle incoming webhook events
 */
async function webhookController(req: Request, _res: Response) {
	console.warn(
		`⚠ This is the default implementation from chargebee-init and must be reviewed!`,
	);
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

/**
 * Initialize the Express app with the Chargebee controllers
 * @param app Express application
 * @returns Express application
 */
export default function init(
	app: Application,
	{ routePrefix = "{{pathPrefix}}" } = {} as { routePrefix: string },
) {
	// Checkout
	app.get(`${routePrefix}/checkout/one-time-charge`, chargeController);
	app.get(`${routePrefix}/checkout/subscription`, subscriptionController);
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
