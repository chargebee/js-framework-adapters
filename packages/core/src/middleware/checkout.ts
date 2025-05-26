import * as Chargebee from "chargebee";
import { validateApiAuth } from "src/utils.js";

export async function charge({
	apiKey,
	site,
	payload,
}: {
	apiKey: string;
	site: string;
	payload: Chargebee.HostedPage.CheckoutOneTimeForItemsInputParam;
}): Promise<
	Chargebee.ChargebeeResponse<Chargebee.HostedPage.CheckoutOneTimeForItemsResponse>
> {
	validateApiAuth(apiKey, site);

	const chargebee = new Chargebee.default({ apiKey, site });
	const response = await chargebee.hostedPage.checkoutOneTimeForItems(payload);
	return response;
}
