import { createEntitlementsRelayHandler } from "@chargebee/entitlements/nextjs";
import { entitlements } from "@/lib/entitlements";
import { getSessionUser } from "@/lib/session";

/** Short, so the browser's refresh is easy to observe. */
const RELAY_TTL_MS = 15_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves the session's sanitized snapshot to the browser client. The API key
 * and customer ID stay on the server:
 *
 *   browser ─GET /api/entitlements─► relay ─► server client ─► Chargebee
 */
export const GET = createEntitlementsRelayHandler({
	entitlements,
	relayTtlMs: RELAY_TTL_MS,
	resolveContext: async () => {
		const user = await getSessionUser();
		return user ? { customerId: user.chargebeeCustomerId } : null;
	},
});
