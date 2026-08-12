import { toResolutionDetails } from "@chargebee/entitlements";
import {
	ChargebeeEntitlements,
	type ChargebeeEntitlementsOptions,
} from "@chargebee/entitlements/server";
import type {
	ErrorCode,
	EvaluationContext,
	JsonValue,
	Logger,
	Provider,
	ResolutionDetails,
} from "@openfeature/server-sdk";

export type ChargebeeEntitlementsProviderOptions =
	| ChargebeeEntitlementsOptions
	| { entitlements: ChargebeeEntitlements };

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

	async resolveBooleanEvaluation(
		flagKey: string,
		defaultValue: boolean,
		context: EvaluationContext,
		logger: Logger,
	): Promise<ResolutionDetails<boolean>> {
		return toResolutionDetails<boolean, ErrorCode>(
			await this.entitlements.getBooleanValue(
				flagKey,
				defaultValue,
				context,
				logger,
			),
		);
	}

	async resolveStringEvaluation(
		flagKey: string,
		defaultValue: string,
		context: EvaluationContext,
		logger: Logger,
	): Promise<ResolutionDetails<string>> {
		return toResolutionDetails<string, ErrorCode>(
			await this.entitlements.getStringValue(
				flagKey,
				defaultValue,
				context,
				logger,
			),
		);
	}

	async resolveNumberEvaluation(
		flagKey: string,
		defaultValue: number,
		context: EvaluationContext,
		logger: Logger,
	): Promise<ResolutionDetails<number>> {
		return toResolutionDetails<number, ErrorCode>(
			await this.entitlements.getNumberValue(
				flagKey,
				defaultValue,
				context,
				logger,
			),
		);
	}

	async resolveObjectEvaluation<T extends JsonValue>(
		flagKey: string,
		defaultValue: T,
		context: EvaluationContext,
		logger: Logger,
	): Promise<ResolutionDetails<T>> {
		return toResolutionDetails<T, ErrorCode>(
			await this.entitlements.getObjectValue(
				flagKey,
				defaultValue,
				context,
				logger,
			),
		);
	}
}
