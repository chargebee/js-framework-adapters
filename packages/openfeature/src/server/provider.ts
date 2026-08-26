import type { ChargebeeTarget } from "@chargebee/entitlements";
import {
	ChargebeeEntitlements,
	type ChargebeeEntitlementsOptions,
} from "@chargebee/entitlements/server";
import type {
	ErrorCode,
	EvaluationContext,
	JsonValue,
	Provider,
	ResolutionDetails,
} from "@openfeature/server-sdk";
import { toResolutionDetails } from "../resolution";

export type ChargebeeEntitlementsProviderOptions =
	| ChargebeeEntitlementsOptions
	| { entitlements: ChargebeeEntitlements };

/**
 * An OpenFeature evaluation context is an untyped bag, so the Chargebee
 * identifiers are picked out of it here. `ChargebeeEntitlements` validates
 * what comes back and reports a missing or ambiguous target as
 * `INVALID_CONTEXT`.
 */
const targetFrom = (context: EvaluationContext): ChargebeeTarget =>
	({
		customerId: context.customerId,
		subscriptionId: context.subscriptionId,
	}) as unknown as ChargebeeTarget;

/**
 * Adapts `@chargebee/entitlements`'s framework-agnostic `ChargebeeEntitlements`
 * client to the OpenFeature server `Provider` interface. All caching,
 * snapshot resolution, and evaluation logic lives in `ChargebeeEntitlements`
 * (exposed here as `.entitlements`) — this class only translates method
 * names and return shapes.
 *
 * Pass either the same options `ChargebeeEntitlements` takes, or
 * `{ entitlements }` to reuse an instance you already constructed elsewhere
 * (e.g. to share it with a relay route or a direct, non-OpenFeature call site).
 */
export class ChargebeeEntitlementsProvider implements Provider {
	readonly metadata = { name: "Chargebee Entitlements" } as const;
	readonly runsOn = "server" as const;
	readonly entitlements: ChargebeeEntitlements;

	constructor(options: ChargebeeEntitlementsProviderOptions) {
		this.entitlements =
			"entitlements" in options
				? options.entitlements
				: new ChargebeeEntitlements(options);
	}

	onClose(): Promise<void> {
		return this.entitlements.close();
	}

	resolveBooleanEvaluation(
		flagKey: string,
		defaultValue: boolean,
		context: EvaluationContext,
	): Promise<ResolutionDetails<boolean>> {
		return this.resolve(flagKey, defaultValue, context);
	}

	resolveStringEvaluation(
		flagKey: string,
		defaultValue: string,
		context: EvaluationContext,
	): Promise<ResolutionDetails<string>> {
		return this.resolve(flagKey, defaultValue, context);
	}

	resolveNumberEvaluation(
		flagKey: string,
		defaultValue: number,
		context: EvaluationContext,
	): Promise<ResolutionDetails<number>> {
		return this.resolve(flagKey, defaultValue, context);
	}

	resolveObjectEvaluation<T extends JsonValue>(
		flagKey: string,
		defaultValue: T,
		context: EvaluationContext,
	): Promise<ResolutionDetails<T>> {
		return this.resolve(flagKey, defaultValue, context);
	}

	/**
	 * One evaluation path for all four flag types: the default value's runtime
	 * type already tells `getValue` which shape to parse the entitlement into.
	 */
	private async resolve<T>(
		flagKey: string,
		defaultValue: T,
		context: EvaluationContext,
	): Promise<ResolutionDetails<T>> {
		return toResolutionDetails<T, ErrorCode>(
			await this.entitlements.getValue(
				flagKey,
				defaultValue,
				targetFrom(context),
			),
		);
	}
}
