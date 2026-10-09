import Chargebee from "chargebee";
import { mockHttpClient } from "./mock-chargebee.ts";

const MOCK_SITE = "mock-site";
const MOCK_API_KEY = "mock-api-key";

const site = process.env.CHARGEBEE_SITE;
const apiKey = process.env.CHARGEBEE_API_KEY;

export const isMockChargebee = !site || !apiKey;

/** Uses your Chargebee site when `.env` has credentials, the mock otherwise. */
export function createChargebee(): Chargebee {
	if (site && apiKey) {
		console.log(`Chargebee: site "${site}"`);
		return new Chargebee({ site, apiKey });
	}

	console.log("Chargebee: no credentials in .env, using the mock API");
	return new Chargebee({
		site: MOCK_SITE,
		apiKey: MOCK_API_KEY,
		httpClient: mockHttpClient,
	});
}
