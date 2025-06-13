import type {
	ChargeInput,
	ManageInput,
	PortalCreateInput,
	SubscriptionInput,
} from "./validators/index.js";

export type ApiPayload<T> =
	// biome-ignore lint: allow any arguments
	((...args: any[]) => T) | ((...args: any[]) => Promise<T>);

export interface ApiAuth {
	apiKey: string;
	site: string;
}

export interface Request<T> extends ApiAuth {
	apiPayload: ApiPayload<T>;
}

export type ChargeRequest = Request<ChargeInput>;
export type SubscriptionRequest = Request<SubscriptionInput>;
export type ManageRequest = Request<ManageInput>;
export type PortalCreateRequest = Request<PortalCreateInput>;
