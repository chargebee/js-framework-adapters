import type { ChargebeeTarget } from "@chargebee/entitlements";
import type { ChargebeeEntitlements } from "@chargebee/entitlements/server";
import type { GenericEndpointContext } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { CHARGEBEE_ERROR_CODES } from "./error-codes";
import { referenceMiddleware, sessionMiddleware } from "./middleware";
import type {
	ChargebeeCtxSession,
	ChargebeeOptions,
	CustomerType,
	EntitlementsAccess,
	Subscription,
	SubscriptionOptions,
	WithChargebeeCustomerId,
} from "./types";
import { getReferenceId } from "./utils";

type Adapter = GenericEndpointContext["context"]["adapter"];

/** `getSnapshot` throws it while a background refresh loads the first snapshot. */
const SNAPSHOT_PENDING_ERROR = "SnapshotPendingError";

/** Without `authorizeReference`, only the session user's own reference passes. */
const NO_SUBSCRIPTION_OPTIONS: SubscriptionOptions = {
	enabled: false,
	plans: [],
};

/** Table holding the Chargebee customer ID of each reference type. */
const CUSTOMER_MODELS: Record<CustomerType, string> = {
	user: "user",
	organization: "organization",
};

/** Request fields picking the billing reference, as on `/subscription/*`. */
interface TargetInput {
	customerType?: CustomerType;
	referenceId?: string;
	subscriptionId?: string;
}

/**
 * Maps the request's reference to a Chargebee target:
 *
 *   subscriptionId given → { subscriptionId }, if the reference owns it
 *   otherwise            → { customerId } of the user or organization
 *   no customer yet      → undefined, so nothing is granted
 */
async function resolveTarget(
	adapter: Adapter,
	session: ChargebeeCtxSession,
	input: TargetInput,
	options: ChargebeeOptions,
): Promise<ChargebeeTarget | undefined> {
	const customerType = input.customerType ?? "user";
	const referenceId =
		input.referenceId ?? getReferenceId(session, customerType, options);

	if (input.subscriptionId) {
		return findSubscription(adapter, referenceId, input.subscriptionId);
	}

	const customerId = await findCustomerId(
		adapter,
		session,
		customerType,
		referenceId,
	);
	if (!customerId) {
		return undefined;
	}

	return { customerId };
}

/** A subscription target, only for a subscription the reference owns. */
async function findSubscription(
	adapter: Adapter,
	referenceId: string,
	subscriptionId: string,
): Promise<ChargebeeTarget> {
	const subscription = await adapter.findOne<Subscription>({
		model: "subscription",
		where: [
			{ field: "chargebeeSubscriptionId", value: subscriptionId },
			{ field: "referenceId", value: referenceId },
		],
	});
	if (!subscription) {
		throw new APIError("FORBIDDEN", {
			message: CHARGEBEE_ERROR_CODES.UNAUTHORIZED_REFERENCE.message,
		});
	}

	return { subscriptionId };
}

/**
 * The session user usually carries its customer ID. Other references, and a
 * session cached before the customer was created, are read from the database.
 */
async function findCustomerId(
	adapter: Adapter,
	session: ChargebeeCtxSession,
	customerType: CustomerType,
	referenceId: string,
): Promise<string | undefined> {
	const isSessionUser =
		customerType === "user" && referenceId === session.user.id;
	if (isSessionUser && session.user.chargebeeCustomerId) {
		return session.user.chargebeeCustomerId;
	}

	const record = await adapter.findOne<WithChargebeeCustomerId>({
		model: CUSTOMER_MODELS[customerType],
		where: [{ field: "id", value: referenceId }],
	});

	return record?.chargebeeCustomerId ?? undefined;
}

/** Resolves the target on first use, then reuses it for the whole request. */
function createAccess(
	client: ChargebeeEntitlements,
	resolve: () => Promise<ChargebeeTarget | undefined>,
): EntitlementsAccess {
	let target: Promise<ChargebeeTarget | undefined> | undefined;
	const getTarget = () => {
		target ??= resolve();
		return target;
	};

	return {
		async hasAccess(feature) {
			const { featureId, defaultValue } =
				typeof feature === "string"
					? { featureId: feature, defaultValue: false }
					: feature;

			const resolved = await getTarget();
			if (!resolved) {
				return defaultValue;
			}

			return client.get(featureId, defaultValue, resolved);
		},

		async getEntitlements() {
			const resolved = await getTarget();
			if (!resolved) {
				return [];
			}

			try {
				const { snapshot } = await client.getSnapshot(resolved);
				return Object.values(snapshot.entitlements);
			} catch (error) {
				if (error instanceof Error && error.name === SNAPSHOT_PENDING_ERROR) {
					return [];
				}
				throw error;
			}
		},
	};
}

/**
 * Adds `ctx.context.entitlements` to Better Auth endpoints, for the session
 * user or the reference picked by `customerType`, `referenceId`, and
 * `subscriptionId`, authorized like the `/subscription/*` routes:
 *
 * ```ts
 * createAuthEndpoint("/reports", { method: "GET", use: [entitlementsMiddleware(options)] },
 *   async (ctx) => ctx.json({ allowed: await ctx.context.entitlements.hasAccess("reports") }));
 * ```
 */
export const entitlementsMiddleware = (options: ChargebeeOptions) =>
	createAuthMiddleware(
		{
			use: [
				sessionMiddleware,
				referenceMiddleware(
					options.subscription ?? NO_SUBSCRIPTION_OPTIONS,
					"read-entitlements",
				),
			],
		},
		async (ctx) => {
			const client = options.entitlements;
			if (!client) {
				throw new APIError("BAD_REQUEST", {
					message: CHARGEBEE_ERROR_CODES.ENTITLEMENTS_NOT_CONFIGURED.message,
				});
			}

			const session = ctx.context.session as ChargebeeCtxSession;
			const input: TargetInput = {
				customerType: ctx.body?.customerType || ctx.query?.customerType,
				referenceId: ctx.body?.referenceId || ctx.query?.referenceId,
				subscriptionId: ctx.body?.subscriptionId || ctx.query?.subscriptionId,
			};

			const entitlements = createAccess(client, () =>
				resolveTarget(ctx.context.adapter, session, input, options),
			);

			return { entitlements };
		},
	);
