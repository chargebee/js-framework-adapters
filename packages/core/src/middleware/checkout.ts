import type * as Chargebee from "chargebee";

import * as client from "../client.js";
import type { ClientConfig } from "../types.js";

export async function oneTime(
	config: ClientConfig,
	payload: Chargebee.HostedPage.CheckoutOneTimeForItemsInputParam,
): Promise<
	Chargebee.ChargebeeResponse<Chargebee.HostedPage.CheckoutOneTimeForItemsResponse>
> {
	const chargebee = await client.get(config);
	const response = await chargebee.hostedPage.checkoutOneTimeForItems(payload);
	return response;
}

export async function subscription(
	config: ClientConfig,
	payload: Chargebee.HostedPage.CheckoutNewForItemsInputParam,
): Promise<
	Chargebee.ChargebeeResponse<Chargebee.HostedPage.CheckoutNewForItemsResponse>
> {
	const chargebee = await client.get(config);
	const response = await chargebee.hostedPage.checkoutNewForItems(payload);
	return response;
}

export async function manage(
	config: ClientConfig,
	payload: Chargebee.HostedPage.ManagePaymentSourcesInputParam,
): Promise<
	Chargebee.ChargebeeResponse<Chargebee.HostedPage.ManagePaymentSourcesResponse>
> {
	const chargebee = await client.get(config);
	const response = await chargebee.hostedPage.managePaymentSources(payload);
	return response;
}
