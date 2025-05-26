import type { ChargeInput } from "./validators/index.js";

export type ApiPayload<T> =
	// biome-ignore lint: allow any arguments
	((...args: any[]) => T) | ((...args: any[]) => Promise<T>);

export interface Request<T> {
	apiKey: string;
	site: string;
	apiPayload: ApiPayload<T>;
}

export type ChargeRequest = Request<ChargeInput>;
