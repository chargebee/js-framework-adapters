import qs from "qs";

export function parseQueryString(url: URL): object {
	return qs.parse(url.search, { ignoreQueryPrefix: true });
}

export function validateApiAuth(apiKey: string, site: string) {
	if (!apiKey || !site) {
		throw new Error(
			`apiKey or site passed to the Chargebee client cannot be undefined`,
		);
	}
}
