import type { BetterAuthPlugin, User } from "better-auth";
import type { Customer } from "chargebee";
import { customerMetadata } from "./metadata";
import { getWebhookEndpoint } from "./routes";
import { getSchema } from "./schema";
import type { ChargebeeOptions, WithChargebeeCustomerId } from "./types";

export const chargebee = (options: ChargebeeOptions) => {
	const cb = options.chargebeeClient;

	return {
		id: "chargebee",
		schema: getSchema(options),
		endpoints: { chargebeeWebhook: getWebhookEndpoint(options) },

		init(ctx) {
			return {
				options: {
					databaseHooks: {
						user: {
							create: {
								async after(user) {
									if (!options.createCustomerOnSignUp) return;
									const existing: any = await cb.customer.list({
										email: { is: user.email },
										limit: 1,
									});

									let chargebeeCustomer: Customer;

									if (existing.list && existing.list.length > 0) {
										chargebeeCustomer = existing.list[0].customer;
									} else {
										const result = await cb.customer.create({
											id: user.id,
											email: user.email,
											first_name: user.name?.split(" ")[0],
											last_name: user.name?.split(" ").slice(1).join(" "),
											meta_data: customerMetadata.set(undefined, {
												userId: user.id,
												customerType: "user",
											}),
										});
										chargebeeCustomer = result.customer;
									}

									await ctx.internalAdapter.updateUser(user.id, {
										chargebeeCustomerId: chargebeeCustomer.id,
									});

									await options.onCustomerCreate?.({
										chargebeeCustomer,
										user,
									});
								},
							},
							update: {
								async after(user: User & WithChargebeeCustomerId) {
									if (!user.chargebeeCustomerId) return;
									try {
										await cb.customer.update(user.chargebeeCustomerId, {
											email: user.email,
										});
									} catch {
										// Silently fail — don't break auth for billing sync issues
									}
								},
							},
						},
					},
				},
			};
		},
	} satisfies BetterAuthPlugin;
};
