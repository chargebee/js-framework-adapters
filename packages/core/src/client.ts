import Chargebee from "chargebee";
import type { ClientConfig } from "./types.js";
import { validateApiAuth } from "./utils.js";

export async function get({
	apiKey,
	site,
	userAgentSuffix,
}: ClientConfig): Promise<Chargebee> {
	validateApiAuth(apiKey, site);
	return new Chargebee({ apiKey, site, userAgentSuffix });
}

export async function getFromEnv(): Promise<Chargebee> {
	return get({
		apiKey: process.env.CHARGEBEE_API_KEY ?? "",
		site: process.env.CHARGEBEE_SITE ?? "",
	});
}
