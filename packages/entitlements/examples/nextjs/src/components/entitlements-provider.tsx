"use client";

import type { EntitlementDetails, Feature } from "@chargebee/entitlements";
import { ChargebeeEntitlements } from "@chargebee/entitlements/web";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

const RELAY_URL = "/api/entitlements";

interface EntitlementsState {
	client: ChargebeeEntitlements;
	/** Bumped whenever the snapshot changes, so consumers re-render. */
	version: number;
	/** Why the first relay load failed; evaluations stay `pending`. */
	loadError?: string;
}

const EntitlementsContext = createContext<EntitlementsState | null>(null);

/**
 * Holds the browser client for the signed-in user. Evaluations are synchronous
 * against the relay snapshot; until it loads they return the default with
 * status `pending`. Key it by user, so switching users starts from an empty
 * snapshot instead of rendering the previous user's.
 */
export function EntitlementsProvider({ children }: { children: ReactNode }) {
	const [version, setVersion] = useState(0);
	const [loadError, setLoadError] = useState<string>();
	const [client] = useState(() => {
		const rerender = () => setVersion((current) => current + 1);
		return new ChargebeeEntitlements({
			relayUrl: RELAY_URL,
			onSnapshotExpired: rerender,
			onSnapshotRefreshed: rerender,
			onError: (error) => console.error("[entitlements] refresh failed", error),
		});
	});

	// Closing on unmount discards a relay response still in flight.
	useEffect(() => {
		client
			.initialize()
			.then(() => setVersion((current) => current + 1))
			.catch((error: Error) => setLoadError(error.message));

		return () => {
			void client.close();
		};
	}, [client]);

	const state = useMemo(
		() => ({ client, version, loadError }),
		[client, version, loadError],
	);

	return (
		<EntitlementsContext.Provider value={state}>
			{children}
		</EntitlementsContext.Provider>
	);
}

function useEntitlementsState(): EntitlementsState {
	const state = useContext(EntitlementsContext);
	if (!state) {
		throw new Error("Wrap the component in <EntitlementsProvider>");
	}

	return state;
}

export function useEntitlementsClient(): ChargebeeEntitlements {
	return useEntitlementsState().client;
}

export function useEntitlementsLoadError(): string | undefined {
	return useEntitlementsState().loadError;
}

/** Evaluates a shared feature declaration against the browser snapshot. */
export function useFeature<T>(feature: Feature<T>): EntitlementDetails<T> {
	const { client } = useEntitlementsState();
	return client.getDetails(feature.featureId, feature.defaultValue);
}
