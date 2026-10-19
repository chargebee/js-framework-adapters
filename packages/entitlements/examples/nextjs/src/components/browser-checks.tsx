"use client";

import { useReducer, useState } from "react";
import {
	advancedReports,
	apiCalls,
	licensedSeats,
	supportTier,
} from "@/lib/features";
import {
	useEntitlementsClient,
	useEntitlementsLoadError,
	useFeature,
} from "./entitlements-provider";
import { FeatureGate } from "./feature-gate";
import { FeatureTable } from "./feature-table";

/** The same features as the server section, read from the relay snapshot. */
export function BrowserChecks() {
	const client = useEntitlementsClient();
	const loadError = useEntitlementsLoadError();
	const [refreshing, setRefreshing] = useState(false);
	const [, reevaluate] = useReducer((count: number) => count + 1, 0);

	const reports = useFeature(advancedReports);
	const seats = useFeature(licensedSeats);
	const calls = useFeature(apiCalls);
	const support = useFeature(supportTier);

	const rows = [
		{ featureId: advancedReports.featureId, details: reports },
		{ featureId: licensedSeats.featureId, details: seats },
		{ featureId: apiCalls.featureId, details: calls },
		{ featureId: supportTier.featureId, details: support },
	];

	// Fetches a fresh snapshot, e.g. after checkout; `onSnapshotRefreshed` re-renders.
	const refresh = async () => {
		setRefreshing(true);
		try {
			await client.refreshSnapshot();
		} finally {
			setRefreshing(false);
		}
	};

	return (
		<>
			{loadError && (
				<p className="error">{loadError}. Every feature keeps its default.</p>
			)}
			<FeatureTable rows={rows} />
			<p>
				<FeatureGate
					feature={advancedReports}
					fallback={<span className="muted">Upgrade to export reports. </span>}
				>
					<button type="button">Export report</button>
				</FeatureGate>
				<button type="button" onClick={reevaluate}>
					Re-evaluate
				</button>
				<button type="button" onClick={refresh} disabled={refreshing}>
					{refreshing ? "Refreshing…" : "Refresh from relay"}
				</button>
			</p>
			<p className="muted">
				<code>Export report</code> is shown by{" "}
				<code>&lt;FeatureGate feature=&#123;advancedReports&#125;&gt;</code>,
				and hidden until the snapshot grants it. Re-evaluating reads the
				snapshot in memory. After 15 seconds it expires, and the next evaluation
				returns <code>stale</code> while the client refetches it (see the
				Network tab).
			</p>
		</>
	);
}
