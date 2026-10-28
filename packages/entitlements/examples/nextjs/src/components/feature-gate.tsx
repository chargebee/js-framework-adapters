"use client";

import type { Feature } from "@chargebee/entitlements";
import type { ReactNode } from "react";
import { useFeature } from "./entitlements-provider";

/**
 * Renders `children` only when the relay snapshot grants `feature`:
 *
 * ```tsx
 * <FeatureGate feature={advancedReports} fallback={<UpgradePrompt />}>
 *   <ExportButton />
 * </FeatureGate>
 * ```
 *
 * Until the snapshot loads, the feature resolves to its default (`false`), so
 * gated content stays hidden rather than flashing in.
 */
export function FeatureGate({
	feature,
	fallback = null,
	children,
}: {
	feature: Feature<boolean>;
	fallback?: ReactNode;
	children: ReactNode;
}) {
	const { value } = useFeature(feature);
	return value ? children : fallback;
}
