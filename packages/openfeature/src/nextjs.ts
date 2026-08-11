import "server-only";

import type { EvaluationContext } from "@openfeature/server-sdk";
import type { NextRequest } from "next/server";
import {
	type ChargebeeEntitlementsProvider,
	createEntitlementsRelayHandler,
} from "./server";

export interface CreateChargebeeEntitlementsHandlerOptions {
	provider: ChargebeeEntitlementsProvider;
	resolveContext: (
		request: NextRequest,
	) => EvaluationContext | null | Promise<EvaluationContext | null>;
	snapshotTtlMs?: number;
	onError?: (
		error: unknown,
		request: NextRequest,
	) => Response | Promise<Response>;
}

export type ChargebeeEntitlementsRouteHandler = (
	request: NextRequest,
) => Promise<Response>;

export function createChargebeeEntitlementsHandler(
	options: CreateChargebeeEntitlementsHandlerOptions,
): ChargebeeEntitlementsRouteHandler {
	const onError = options.onError;
	const handler = createEntitlementsRelayHandler({
		provider: options.provider,
		resolveContext: (request) => options.resolveContext(request as NextRequest),
		snapshotTtlMs: options.snapshotTtlMs,
		onError: onError
			? (error, request) => onError(error, request as NextRequest)
			: undefined,
	});

	return (request: NextRequest) => handler(request);
}

export function createChargebeeEntitlementsRoute(
	options: CreateChargebeeEntitlementsHandlerOptions,
): { GET: ChargebeeEntitlementsRouteHandler } {
	return { GET: createChargebeeEntitlementsHandler(options) };
}

export type {
	ChargebeeEntitlementsProvider,
	ChargebeeEntitlementsProviderOptions,
} from "./server";
