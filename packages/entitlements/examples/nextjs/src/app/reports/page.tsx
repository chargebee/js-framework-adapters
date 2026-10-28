import Link from "next/link";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/entitlements";
import { advancedReports } from "@/lib/features";
import { getSessionUser } from "@/lib/session";

/** Gated on the server, so nothing reaches users without the feature. */
export default async function ReportsPage() {
	const user = await getSessionUser();
	if (!user) {
		redirect("/");
	}

	const allowed = await hasFeature(user, advancedReports);

	return (
		<>
			<h1>Advanced reports</h1>
			<section>
				{allowed ? (
					<p className="granted">Revenue by region: APAC 1,200.</p>
				) : (
					<p className="disabled">
						{user.name} has no <code>{advancedReports.featureId}</code>{" "}
						entitlement. Upgrade to see this report.
					</p>
				)}
			</section>
			<p>
				<Link href="/">Back</Link>
			</p>
		</>
	);
}
