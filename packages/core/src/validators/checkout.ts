import type * as Chargebee from "chargebee";

import { z } from "zod";

export const customerSchema = z.object({
	id: z.string().optional(),
	email: z.string().optional(),
	first_name: z.string().optional(),
	last_name: z.string().optional(),
	company: z.string().optional(),
	phone: z.string().optional(),
	locale: z.string().optional(),
	taxability: z.enum(["taxable", "exempt"]).optional(),
	vat_number: z.string().optional(),
	vat_number_prefix: z.string().optional(),
	einvoicing_method: z.enum(["automatic", "manual", "site_default"]).optional(),
	is_einvoice_enabled: z.boolean().optional(),
	entity_identifier_scheme: z.string().optional(),
	entity_identifier_standard: z.string().optional(),
	consolidated_invoicing: z.boolean().optional(),
});

export const itemPricesSchema = z.object({
	item_price_id: z.string().optional(),
	quantity: z.number().optional(),
	quantity_in_decimal: z.string().optional(),
	unit_price: z.number().optional(),
	unit_price_in_decimal: z.string().optional(),
	date_from: z.number().optional(),
	date_to: z.number().optional(),
});

export const chargeInputSchema = z.object({
	business_entity_id: z.string().optional(),
	layout: z.enum(["in_app", "full_page"]).optional(),
	coupon: z.string().optional(),
	coupon_ids: z.array(z.string()).optional(),
	currency_code: z.string().optional(),
	redirect_url: z.string().optional(),
	cancel_url: z.string().optional(),
	pass_thru_content: z.string().optional(),
	customer: customerSchema.optional(),
	// invoice?: InvoiceCheckoutOneTimeForItemsInputParam;
	// card?: CardCheckoutOneTimeForItemsInputParam;
	// billing_address?: BillingAddressCheckoutOneTimeForItemsInputParam;
	// shipping_address?: ShippingAddressCheckoutOneTimeForItemsInputParam;
	item_prices: z.array(itemPricesSchema).optional(),
	// item_tiers?: ItemTiersCheckoutOneTimeForItemsInputParam[];
	// charges?: ChargesCheckoutOneTimeForItemsInputParam[];
	// discounts?: DiscountsCheckoutOneTimeForItemsInputParam[];
	// entity_identifiers?: EntityIdentifiersCheckoutOneTimeForItemsInputParam[];
});
