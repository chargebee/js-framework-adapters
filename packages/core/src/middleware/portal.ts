import type * as Chargebee from "chargebee";

import * as client from "../client.js";
import type { ApiAuth } from "../types.js";

export async function create({
	apiKey,
	site,
	payload,
}: ApiAuth & {
	payload: Chargebee.PortalSession.CreateInputParam;
}): Promise<
	Chargebee.ChargebeeResponse<Chargebee.PortalSession.CreateResponse>
> {
	const chargebee = await client.get({ apiKey, site });
	const response = await chargebee.portalSession.create(payload);
	return response;
}
