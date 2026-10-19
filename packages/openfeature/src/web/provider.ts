import {
	ChargebeeEntitlements,
	type ChargebeeEntitlementsOptions,
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
import { PendingAs, toResolutionDetails } from "../resolution";

export type ChargebeeEntitlementsWebProviderOptions = Omit<
	ChargebeeEntitlementsOptions,
	"onSnapshotExpired" | "onSnapshotRefreshed" | "onError"
>;

/**
 * Adapts `@chargebee/entitlements/web`'s framework-agnostic
 * `ChargebeeEntitlements` to the OpenFeature web `Provider` interface. All
 * relay-fetch and evaluation logic lives in `ChargebeeEntitlements` (exposed
 * here as `.entitlements`) — this class only bridges its callbacks to
 * OpenFeature's event emitter.
 */
export class ChargebeeEntitlementsWebProvider implements Provider {
	readonly metadata = { name: "Chargebee Entitlements" } as const;
	readonly runsOn = "client" as const;
	readonly events = new OpenFeatureEventEmitter();
	readonly entitlements: ChargebeeEntitlements;

	constructor(options: ChargebeeEntitlementsWebProviderOptions) {
		this.entitlements = new ChargebeeEntitlements({
			...options,
			onSnapshotExpired: () => {
				this.events.emit(ProviderEvents.Stale, {
					message: "Chargebee entitlement snapshot expired",
				});
			},
			onSnapshotRefreshed: ({ changedFeatureIds }) => {
				if (changedFeatureIds.length === 0) {
					return;
				}

				this.events.emit(ProviderEvents.ConfigurationChanged, {
					flagsChanged: changedFeatureIds,
				});
			},
			onError: (error) => {
				this.events.emit(ProviderEvents.Error, {
					message:
						error instanceof Error
							? error.message
							: "Unable to refresh Chargebee entitlements",
				});
			},
		});
	}

	initialize(): Promise<void> {
		return this.entitlements.initialize();
	}

	onContextChange(
		_oldContext: EvaluationContext,
		_newContext: EvaluationContext,
	): Promise<void> {
		return this.entitlements.reset();
	}

	onClose(): Promise<void> {
		return this.entitlements.close();
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
	 * type already tells `getDetails` which shape to parse the entitlement into.
	 * The relay snapshot is scoped to the session, so the context is unused.
	 */
	private resolve<T>(flagKey: string, defaultValue: T): ResolutionDetails<T> {
		return toResolutionDetails<T, ErrorCode>(
			this.entitlements.getDetails(flagKey, defaultValue),
			PendingAs.NotReady,
		);
	}
}
