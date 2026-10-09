import { Feature } from "@chargebee/entitlements";
import { ChargebeeEntitlements } from "@chargebee/entitlements/server";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import type Chargebee from "chargebee";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { chargebee, entitlementsMiddleware } from "../src";
import { CHARGEBEE_ERROR_CODES } from "../src/error-codes";
import type { ChargebeeOptions } from "../src/types";

const USER_CUSTOMER_ID = "cus_user";
const ORG_CUSTOMER_ID = "cus_org";
const SUBSCRIPTION_ID = "sub_1";

/** Chargebee answering every customer with `sso` and `seats`, every subscription with `reports`. */
function makeChargebee() {
	const customerRequest = vi.fn(async () => ({
		list: [
			{
				customer_entitlement: {
					feature_id: "sso",
					value: "true",
					is_enabled: true,
				},
			},
			{
				customer_entitlement: {
					feature_id: "seats",
					value: "10",
					is_enabled: true,
				},
			},
		],
	}));
	const subscriptionRequest = vi.fn(async () => ({
		list: [
			{
				subscription_entitlement: {
					feature_id: "reports",
					value: "true",
					is_enabled: true,
				},
			},
		],
	}));
	const chargebeeClient = {
		__clientIdentifier: () => {},
		customerEntitlement: { entitlementsForCustomer: customerRequest },
		subscriptionEntitlement: {
			subscriptionEntitlementsForSubscription: subscriptionRequest,
		},
	} as unknown as Chargebee;

	return { chargebeeClient, customerRequest, subscriptionRequest };
}

/** Test-only endpoint exercising the middleware the way an app would. */
function probePlugin(options: ChargebeeOptions) {
	return {
		id: "probe",
		endpoints: {
			probe: createAuthEndpoint(
				"/probe",
				{
					method: "GET",
					query: z.object({ subscriptionId: z.string().optional() }),
					use: [entitlementsMiddleware(options)],
				},
				async (ctx) => {
					const { entitlements } = ctx.context;
					const premium = new Feature("premium", true);

					return ctx.json({
						premium: await entitlements.hasAccess(premium),
						reports: await entitlements.hasAccess("reports"),
						entitlements: await entitlements.getEntitlements(),
					});
				},
			),
		},
	} satisfies BetterAuthPlugin;
}

async function setup(overrides: Partial<ChargebeeOptions> = {}) {
	const chargebeeMock = makeChargebee();
	const options: ChargebeeOptions = {
		chargebeeClient: chargebeeMock.chargebeeClient,
		entitlements: new ChargebeeEntitlements({
			chargebeeClient: chargebeeMock.chargebeeClient,
		}),
		subscription: {
			enabled: true,
			plans: [],
			authorizeReference: async () => true,
		},
		...overrides,
	};

	const plugins = [chargebee(options), probePlugin(options)];
	const { auth, signInWithTestUser } = await getTestInstance({
		plugins: options.organization?.enabled
			? [organization(), ...plugins]
			: plugins,
	});
	const { headers, user } = await signInWithTestUser();
	const context = await auth.$context;

	return { auth, headers, user, context, ...chargebeeMock };
}

describe("entitlements - customer target", () => {
	it("evaluates the session user's customer", async () => {
		const { auth, headers, user, context, customerRequest } = await setup();
		await context.internalAdapter.updateUser(user.id, {
			chargebeeCustomerId: USER_CUSTOMER_ID,
		});

		const result = await auth.api.hasAccess({
			headers,
			body: { featureId: "sso" },
		});

		expect(result).toEqual({ hasAccess: true });
		expect(customerRequest).toHaveBeenCalledWith(
			USER_CUSTOMER_ID,
			expect.anything(),
		);
	});

	it("lists the customer's entitlements", async () => {
		const { auth, headers, user, context } = await setup();
		await context.internalAdapter.updateUser(user.id, {
			chargebeeCustomerId: USER_CUSTOMER_ID,
		});

		const entitlements = await auth.api.getEntitlements({ headers });

		expect(entitlements.map((entitlement) => entitlement.featureId)).toEqual([
			"sso",
			"seats",
		]);
	});

	it("evaluates the active organization's customer", async () => {
		const { auth, headers, context, customerRequest } = await setup({
			organization: { enabled: true },
		});
		const org = await auth.api.createOrganization({
			headers,
			body: { name: "Acme", slug: "acme" },
		});
		await context.adapter.update({
			model: "organization",
			where: [{ field: "id", value: org?.id ?? "" }],
			update: { chargebeeCustomerId: ORG_CUSTOMER_ID },
		});

		const result = await auth.api.hasAccess({
			headers,
			body: { featureId: "sso", customerType: "organization" },
		});

		expect(result).toEqual({ hasAccess: true });
		expect(customerRequest).toHaveBeenCalledWith(
			ORG_CUSTOMER_ID,
			expect.anything(),
		);
	});

	it("denies access without a Chargebee customer", async () => {
		const { auth, headers, customerRequest } = await setup();

		const result = await auth.api.hasAccess({
			headers,
			body: { featureId: "sso" },
		});
		const entitlements = await auth.api.getEntitlements({ headers });

		expect(result).toEqual({ hasAccess: false });
		expect(entitlements).toEqual([]);
		expect(customerRequest).not.toHaveBeenCalled();
	});
});

describe("entitlements - subscription target", () => {
	it("evaluates a subscription the reference owns", async () => {
		const { auth, headers, user, context, subscriptionRequest } =
			await setup();
		await context.adapter.create({
			model: "subscription",
			data: {
				referenceId: user.id,
				chargebeeSubscriptionId: SUBSCRIPTION_ID,
				status: "active",
			},
		});

		const result = await auth.api.hasAccess({
			headers,
			body: { featureId: "reports", subscriptionId: SUBSCRIPTION_ID },
		});

		expect(result).toEqual({ hasAccess: true });
		expect(subscriptionRequest).toHaveBeenCalledWith(
			SUBSCRIPTION_ID,
			expect.anything(),
		);
	});

	it("rejects a subscription of another reference", async () => {
		const { auth, headers, context, subscriptionRequest } = await setup();
		await context.adapter.create({
			model: "subscription",
			data: {
				referenceId: "someone-else",
				chargebeeSubscriptionId: SUBSCRIPTION_ID,
				status: "active",
			},
		});

		await expect(
			auth.api.hasAccess({
				headers,
				body: { featureId: "reports", subscriptionId: SUBSCRIPTION_ID },
			}),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		expect(subscriptionRequest).not.toHaveBeenCalled();
	});
});

describe("entitlements - middleware", () => {
	it("uses a boolean feature's own default", async () => {
		const { auth, headers } = await setup();

		const result = await auth.api.probe({ headers, query: {} });

		expect(result).toEqual({
			premium: true,
			reports: false,
			entitlements: [],
		});
	});

	it("resolves the target once per request", async () => {
		const { auth, headers, user, context } = await setup();
		await context.adapter.create({
			model: "subscription",
			data: {
				referenceId: user.id,
				chargebeeSubscriptionId: SUBSCRIPTION_ID,
				status: "active",
			},
		});
		const findOne = vi.spyOn(context.adapter, "findOne");

		const result = await auth.api.probe({
			headers,
			query: { subscriptionId: SUBSCRIPTION_ID },
		});

		const subscriptionLookups = findOne.mock.calls.filter(
			([query]) => query.model === "subscription",
		);
		expect(subscriptionLookups).toHaveLength(1);
		expect(result.reports).toBe(true);
	});

	it("requires the entitlements option", async () => {
		const { auth, headers } = await setup({ entitlements: undefined });

		await expect(
			auth.api.hasAccess({ headers, body: { featureId: "sso" } }),
		).rejects.toMatchObject({
			message: CHARGEBEE_ERROR_CODES.ENTITLEMENTS_NOT_CONFIGURED.message,
		});
	});
});

/** Compile-time only: non-boolean features have no access semantics. */
function _rejectsNonBooleanFeatures(options: ChargebeeOptions) {
	createAuthEndpoint(
		"/typed",
		{ method: "GET", use: [entitlementsMiddleware(options)] },
		async (ctx) => {
			// @ts-expect-error a number feature is not a switch
			await ctx.context.entitlements.hasAccess(new Feature("seats", 0));
		},
	);
}
