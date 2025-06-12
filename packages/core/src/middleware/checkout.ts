import type * as Chargebee from "chargebee";

import * as client from "../client.js";
import type { ApiAuth } from "../types.js";

export async function charge({
	apiKey,
	site,
	payload,
}: ApiAuth & {
	payload: Chargebee.HostedPage.CheckoutOneTimeForItemsInputParam;
}): Promise<
	Chargebee.ChargebeeResponse<Chargebee.HostedPage.CheckoutOneTimeForItemsResponse>
> {
	const chargebee = await client.get({ apiKey, site });
	const response = await chargebee.hostedPage.checkoutOneTimeForItems(payload);
	return response;
}

export async function subscribe({
	apiKey,
	site,
	payload,
}: ApiAuth & {
	payload: Chargebee.HostedPage.CheckoutNewForItemsInputParam;
}): Promise<
	Chargebee.ChargebeeResponse<Chargebee.HostedPage.CheckoutNewForItemsResponse>
> {
	const chargebee = await client.get({ apiKey, site });
	const response = await chargebee.hostedPage.checkoutNewForItems(payload);
	return response;
}

export async function managePayment({
	apiKey,
	site,
	payload,
}: ApiAuth & {
	payload: Chargebee.HostedPage.ManagePaymentSourcesInputParam;
}): Promise<
	Chargebee.ChargebeeResponse<Chargebee.HostedPage.ManagePaymentSourcesResponse>
> {
	const chargebee = await client.get({ apiKey, site });
	const response = await chargebee.hostedPage.managePaymentSources(payload);
	return response;
}
