import {
	ChargebeeEntitlementsWebClient,
	type ChargebeeEntitlementsWebClientOptions,
} from "@chargebee/entitlements/web";
import {
	type ErrorCode,
	type EvaluationContext,
	type JsonValue,
	OpenFeatureEventEmitter,
	type Provider,
	ProviderEvents,
	type ResolutionDetails,
} from "@openfeature/web-sdk";
import { toResolutionDetails } from "../resolution";

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
	): ResolutionDetails<boolean> {
		return this.resolve(flagKey, defaultValue);
	}

	resolveStringEvaluation(
		flagKey: string,
		defaultValue: string,
	): ResolutionDetails<string> {
		return this.resolve(flagKey, defaultValue);
	}

	resolveNumberEvaluation(
		flagKey: string,
		defaultValue: number,
	): ResolutionDetails<number> {
		return this.resolve(flagKey, defaultValue);
	}

	resolveObjectEvaluation<T extends JsonValue>(
		flagKey: string,
		defaultValue: T,
	): ResolutionDetails<T> {
		return this.resolve(flagKey, defaultValue);
	}

	/**
	 * One evaluation path for all four flag types: the default value's runtime
	 * type already tells `getValue` which shape to parse the entitlement into.
	 * The relay snapshot is scoped to the session, so the context is unused.
	 */
	private resolve<T>(flagKey: string, defaultValue: T): ResolutionDetails<T> {
		return toResolutionDetails<T, ErrorCode>(
			this.client.getValue(flagKey, defaultValue),
		);
	}
}
