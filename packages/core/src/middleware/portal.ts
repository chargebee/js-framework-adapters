import type * as Chargebee from "chargebee";

import * as client from "../client.js";
import type { ClientConfig } from "../types.js";

export async function create(
	config: ClientConfig,
	payload: Chargebee.PortalSession.CreateInputParam,
): Promise<
	Chargebee.ChargebeeResponse<Chargebee.PortalSession.CreateResponse>
> {
	const chargebee = await client.get(config);
	const response = await chargebee.portalSession.create(payload);
	return response;
}
