import type { ChargebeeEntitlementsSnapshot, ChargebeeTarget } from "../shared";

export type EntitlementsRelayHandler<TRequest extends Request = Request> = (
	request: TRequest,
) => Promise<Response>;

/** The subset of `ChargebeeEntitlements` (or an adapter over it) the relay needs. */
export interface EntitlementsRelaySource {
	getRelaySnapshot(
		target: ChargebeeTarget,
		ttlMs?: number,
	): Promise<ChargebeeEntitlementsSnapshot>;
}

export interface CreateEntitlementsRelayHandlerOptions<
	TRequest extends Request = Request,
> {
	entitlements: EntitlementsRelaySource;
	/**
	 * Derives the billing target from the authenticated server session. Return
	 * `null` to respond 401.
	 */
	resolveContext: (
		request: TRequest,
	) => ChargebeeTarget | null | Promise<ChargebeeTarget | null>;
	/** How long the browser client should trust the snapshot before re-fetching. */
	relayTtlMs?: number;
	onError?: (error: unknown, request: TRequest) => Response | Promise<Response>;
}

/**
 * Billing identity comes from the server session, never the request. A client
 * that supplies either identifier is rejected outright rather than ignored.
 */
const IDENTITY_PARAMS = ["customerId", "subscriptionId"] as const;

const responseHeaders = {
	"Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
	"Content-Type": "application/json",
} as const;

const json = (
	body: unknown,
	status: number,
	headers: HeadersInit = responseHeaders,
) => Response.json(body, { status, headers });

export function createEntitlementsRelayHandler<
	TRequest extends Request = Request,
>(
	options: CreateEntitlementsRelayHandlerOptions<TRequest>,
): EntitlementsRelayHandler<TRequest> {
	return async (request) => {
		try {
			if (request.method !== "GET") {
				return json({ error: "Method not allowed" }, 405, {
					...responseHeaders,
					Allow: "GET",
				});
			}

			const search = new URL(request.url).searchParams;
			if (IDENTITY_PARAMS.some((key) => search.has(key))) {
				return json(
					{ error: "Billing identity must be resolved by the server" },
					400,
				);
			}

			const target = await options.resolveContext(request);
			if (!target) return json({ error: "Unauthorized" }, 401);

			return json(
				await options.entitlements.getRelaySnapshot(target, options.relayTtlMs),
				200,
			);
		} catch (error) {
			return options.onError
				? options.onError(error, request)
				: json({ error: "Unable to load entitlements" }, 502);
		}
	};
}
