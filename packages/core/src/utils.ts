import qs from "qs";

export function parseQueryString(url: URL): object {
	return qs.parse(url.search, { ignoreQueryPrefix: true });
}
