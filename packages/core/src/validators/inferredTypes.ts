import type * as Chargebee from "chargebee";

// TODO: export the inferred types from zod once we start using
// the schema to validate the types. For now, these are just a shortcut
// to the types in the SDK
export type ChargeCustomer =
	Chargebee.HostedPage.CustomerCheckoutOneTimeForItemsInputParam;
export type ChargeInput =
	Chargebee.HostedPage.CheckoutOneTimeForItemsInputParam;
