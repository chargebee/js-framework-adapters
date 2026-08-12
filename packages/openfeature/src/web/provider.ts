import { toResolutionDetails } from "@chargebee/entitlements";
import {
	ChargebeeEntitlementsWebClient,
	type ChargebeeEntitlementsWebClientOptions,
} from "@chargebee/entitlements/web";
import {
	type ErrorCode,
	type EvaluationContext,
	type JsonValue,
	type Logger,
	OpenFeatureEventEmitter,
	type Provider,
	ProviderEvents,
	type ResolutionDetails,
} from "@openfeature/web-sdk";

export type ChargebeeEntitlementsWebProviderOptions = Omit<
	ChargebeeEntitlementsWebClientOptions,
	"onStale" | "onConfigurationChanged" | "onError"
>;

/**
 * Adapts `@chargebee/entitlements`'s framework-agnostic
 * `ChargebeeEntitlementsWebClient` to the OpenFeature web `Provider`
 * interface. All relay-fetch and evaluation logic lives in
 * `ChargebeeEntitlementsWebClient` (exposed here as `.client`) — this class
 * only bridges its callbacks to OpenFeature's event emitter.
 */
export class ChargebeeEntitlementsWebProvider implements Provider {
	readonly metadata = { name: "Chargebee Entitlements" } as const;
	readonly runsOn = "client" as const;
	readonly events = new OpenFeatureEventEmitter();
	readonly client: ChargebeeEntitlementsWebClient;

	constructor(options: ChargebeeEntitlementsWebProviderOptions) {
		this.client = new ChargebeeEntitlementsWebClient({
			...options,
			onStale: () => {
				this.events.emit(ProviderEvents.Stale, {
					message: "Chargebee entitlement snapshot expired",
				});
			},
			onConfigurationChanged: (flagsChanged) => {
				this.events.emit(ProviderEvents.ConfigurationChanged, {
					flagsChanged,
				});
			},
			onError: (message) => {
				this.events.emit(ProviderEvents.Error, { message });
			},
		});
	}

	initialize(): Promise<void> {
		return this.client.initialize();
	}

	onContextChange(
		_oldContext: EvaluationContext,
		_newContext: EvaluationContext,
	): Promise<void> {
		return this.client.reset();
	}

	onClose(): Promise<void> {
		return this.client.close();
	}

	resolveBooleanEvaluation(
		flagKey: string,
		defaultValue: boolean,
		_context: EvaluationContext,
		_logger: Logger,
	): ResolutionDetails<boolean> {
		return toResolutionDetails<boolean, ErrorCode>(
			this.client.getBooleanValue(flagKey, defaultValue),
		);
	}

	resolveStringEvaluation(
		flagKey: string,
		defaultValue: string,
		_context: EvaluationContext,
		_logger: Logger,
	): ResolutionDetails<string> {
		return toResolutionDetails<string, ErrorCode>(
			this.client.getStringValue(flagKey, defaultValue),
		);
	}

	resolveNumberEvaluation(
		flagKey: string,
		defaultValue: number,
		_context: EvaluationContext,
		_logger: Logger,
	): ResolutionDetails<number> {
		return toResolutionDetails<number, ErrorCode>(
			this.client.getNumberValue(flagKey, defaultValue),
		);
	}

	resolveObjectEvaluation<T extends JsonValue>(
		flagKey: string,
		defaultValue: T,
		_context: EvaluationContext,
		_logger: Logger,
	): ResolutionDetails<T> {
		return toResolutionDetails<T, ErrorCode>(
			this.client.getObjectValue(flagKey, defaultValue),
		);
	}
}
