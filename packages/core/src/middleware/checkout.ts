import * as Chargebee from "chargebee";
import type { ApiAuth } from "../types.js";
import { validateApiAuth } from "../utils.js";

export async function charge({
	apiKey,
	site,
	payload,
}: ApiAuth & {
	payload: Chargebee.HostedPage.CheckoutOneTimeForItemsInputParam;
}): Promise<
	Chargebee.ChargebeeResponse<Chargebee.HostedPage.CheckoutOneTimeForItemsResponse>
> {
	validateApiAuth(apiKey, site);

	const chargebee = new Chargebee.default({ apiKey, site });
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
	validateApiAuth(apiKey, site);

	const chargebee = new Chargebee.default({ apiKey, site });
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
	validateApiAuth(apiKey, site);

	const chargebee = new Chargebee.default({ apiKey, site });
	const response = await chargebee.hostedPage.managePaymentSources(payload);
	return response;
}
