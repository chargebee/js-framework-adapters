import "server-only";

import type { NextRequest } from "next/server";
import {
	type CreateEntitlementsRelayHandlerOptions,
	createEntitlementsRelayHandler as createRelayHandler,
} from "./server/relay";

/**
 * Builds an App Router `GET` handler that resolves billing identity on the
 * server and returns a sanitized entitlement snapshot for a browser client.
 * This is the Next.js `NextRequest` instantiation of
 * `createEntitlementsRelayHandler` from `@chargebee/entitlements/server`.
 */
export function createEntitlementsRelayHandler(
	options: CreateEntitlementsRelayHandlerOptions<NextRequest>,
): (request: NextRequest) => Promise<Response> {
	return createRelayHandler<NextRequest>(options);
}

export type { CreateEntitlementsRelayHandlerOptions };
