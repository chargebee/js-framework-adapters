import type { GenericEndpointContext } from "@better-auth/core";
import type { ChargebeeOptions, Logger, WebhookEvent } from "./types";
import {
	type BetterAuthWebhookContext,
	dispatchWebhookEvent,
} from "./webhook-handler";

/**
 * Minimal shape of a better-auth context required to process webhook events.
 * The DB-sync hooks only need an adapter and a logger.
 */
interface ChargebeeProcessorContext {
	adapter: BetterAuthWebhookContext["adapter"];
	logger: Logger;
}

/**
 * Source used by the processor to obtain a better-auth context.
 *
 * - `auth`: an in-process better-auth instance. The context is resolved lazily
 *   via `auth.$context`, so the same processor can be reused across messages.
 * - `context`: an explicit adapter + logger, for consumers that run in a
 *   separate process and construct their own context.
 */
export type ChargebeeWebhookProcessorSource =
	| { auth: { $context: Promise<ChargebeeProcessorContext> } }
	| { context: ChargebeeProcessorContext };

export interface ChargebeeWebhookProcessor {
	/**
	 * Process a single queued Chargebee webhook event by running the matching
	 * DB-sync hook. Safe to call repeatedly for the same event - the hooks
	 * guard against duplicate records.
	 */
	process(event: WebhookEvent): Promise<void>;
}

/**
 * Creates a processor for Chargebee webhook events consumed from a queue.
 *
 * Pair this with {@link ChargebeeOptions.webhookEventBus}: the webhook endpoint
 * validates + parses each event and publishes it to your queue, then your
 * consumer calls `processor.process(event)` to run the plugin's hooks.
 *
 * @example In-process consumer
 * ```ts
 * const processor = createChargebeeWebhookProcessor(options, { auth });
 * await processor.process(event);
 * ```
 *
 * @example Separate process consumer
 * ```ts
 * const processor = createChargebeeWebhookProcessor(options, {
 *   context: { adapter, logger },
 * });
 * await processor.process(event);
 * ```
 */
export function createChargebeeWebhookProcessor(
	options: ChargebeeOptions,
	source: ChargebeeWebhookProcessorSource,
): ChargebeeWebhookProcessor {
	const resolveContext = async (): Promise<ChargebeeProcessorContext> => {
		if ("auth" in source) {
			const authCtx = await source.auth.$context;
			return { adapter: authCtx.adapter, logger: authCtx.logger };
		}
		return source.context;
	};

	return {
		async process(event: WebhookEvent) {
			const { adapter, logger } = await resolveContext();

			const endpointCtx = {
				context: { adapter, logger },
			} as unknown as GenericEndpointContext;

			const wrapperCtx: BetterAuthWebhookContext = {
				context: { adapter, logger },
				adapter,
				logger,
			};

			await dispatchWebhookEvent(event, endpointCtx, wrapperCtx, options);
		},
	};
}
