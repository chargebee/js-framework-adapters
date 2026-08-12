import {
	CHARGEBEE_CONTEXT_KEYS,
	type ChargebeeEntitlementsSnapshot,
	type ChargebeeTarget,
	type EvaluationContextLike,
} from "../shared";

export type EntitlementsRelayHandler<TRequest extends Request = Request> = (
	request: TRequest,
) => Promise<Response>;

/** The subset of `ChargebeeEntitlements` (or an adapter over it) the relay needs. */
export interface EntitlementsRelaySource {
	getRelaySnapshot(
		target: ChargebeeTarget | EvaluationContextLike,
		ttlMs?: number,
	): Promise<ChargebeeEntitlementsSnapshot>;
}

export interface CreateEntitlementsRelayHandlerOptions<
	TRequest extends Request = Request,
> {
	entitlements: EntitlementsRelaySource;
	resolveContext: (
		request: TRequest,
	) =>
		| ChargebeeTarget
		| EvaluationContextLike
		| null
		| Promise<ChargebeeTarget | EvaluationContextLike | null>;
	snapshotTtlMs?: number;
	onError?: (error: unknown, request: TRequest) => Response | Promise<Response>;
}

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
			if (
				Object.values(CHARGEBEE_CONTEXT_KEYS).some((key) => search.has(key))
			) {
				return json(
					{ error: "Billing identity must be resolved by the server" },
					400,
				);
			}

			const context = await options.resolveContext(request);
			if (!context) return json({ error: "Unauthorized" }, 401);

			return json(
				await options.entitlements.getRelaySnapshot(
					context,
					options.snapshotTtlMs,
				),
				200,
			);
		} catch (error) {
			return options.onError
				? options.onError(error, request)
				: json({ error: "Unable to load entitlements" }, 502);
		}
	};
}
