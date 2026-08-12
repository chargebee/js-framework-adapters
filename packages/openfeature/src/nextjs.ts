import "server-only";

import type { NextRequest } from "next/server";
import {
	type CreateEntitlementsRelayHandlerOptions,
	createEntitlementsRelayHandler as createRelayHandler,
	type EntitlementsRelayHandler,
} from "./server";

/**
 * Builds an App Router `GET` handler that resolves billing identity on the
 * server and returns a sanitized entitlement snapshot for the browser
 * provider. This is the Next.js `NextRequest` instantiation of
 * `createEntitlementsRelayHandler` from `@chargebee/openfeature/server`.
 */
export function createEntitlementsRelayHandler(
	options: CreateEntitlementsRelayHandlerOptions<NextRequest>,
): EntitlementsRelayHandler<NextRequest> {
	return createRelayHandler<NextRequest>(options);
}

export type { CreateEntitlementsRelayHandlerOptions, EntitlementsRelayHandler };
