import type { EntitlementDetails } from "@chargebee/entitlements";

export interface FeatureRow {
	featureId: string;
	details: EntitlementDetails<unknown>;
}

/** `Infinity` is how an "unlimited" entitlement resolves for a number feature. */
function formatValue(value: unknown): string {
	if (value === Number.POSITIVE_INFINITY) {
		return "unlimited";
	}

	return String(value);
}

/** Renders on the server and in the browser alike: it has no hooks. */
export function FeatureTable({ rows }: { rows: FeatureRow[] }) {
	return (
		<table>
			<thead>
				<tr>
					<th>Feature</th>
					<th>Value</th>
					<th>Status</th>
					<th>Source</th>
				</tr>
			</thead>
			<tbody>
				{rows.map(({ featureId, details }) => (
					<tr key={featureId}>
						<td>
							<code>{featureId}</code>
						</td>
						<td>{formatValue(details.value)}</td>
						<td className={details.status} title={details.error?.message}>
							{details.status}
							{details.error ? ` (${details.error.code})` : ""}
						</td>
						<td className="muted">{details.source ?? "none"}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
