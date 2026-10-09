import Link from "next/link";
import { BrowserChecks } from "@/components/browser-checks";
import { EntitlementsProvider } from "@/components/entitlements-provider";
import { FeatureTable } from "@/components/feature-table";
import { UserProfiles } from "@/components/user-profiles";
import { isMockChargebee } from "@/lib/chargebee";
import { entitlementsFor } from "@/lib/entitlements";
import { FEATURES } from "@/lib/features";
import { getSessionUser, USER_FIELD } from "@/lib/session";
import { listUsers, type User } from "@/lib/users";
import { switchUser } from "./actions";

/** Every feature, evaluated on the server before the page is sent. */
async function serverRows(user: User) {
	const scoped = entitlementsFor(user);

	return Promise.all(
		FEATURES.map(async (feature) => ({
			featureId: feature.featureId,
			details: await scoped.getDetails(feature.featureId, feature.defaultValue),
		})),
	);
}

export default async function Home() {
	const user = await getSessionUser();

	return (
		<>
			<h1>Chargebee entitlements</h1>
			<p>Next.js example - server and client side checks</p>
			{isMockChargebee && (
				<p className="notice">
					No Chargebee credentials in <code>.env</code>: answering from the mock
					API. Its calls are logged in the terminal.
				</p>
			)}

			{isMockChargebee ? (
				<section>
					<h2>Demo users</h2>
					<UserProfiles users={listUsers()} currentUserId={user?.id} />
				</section>
			) : (
				<section>
					<h2>Signed in as</h2>
					<form action={switchUser}>
						{listUsers().map(({ id, name }) => (
							<button
								key={id}
								type="submit"
								name={USER_FIELD}
								value={id}
								disabled={id === user?.id}
							>
								{name}
							</button>
						))}
						<button type="submit" disabled={!user}>
							Sign out
						</button>
					</form>
				</section>
			)}

			{user ? (
				<>
					<section>
						<h2>Server</h2>
						<FeatureTable rows={await serverRows(user)} />
						<p className="muted">
							Rendered by a server component with{" "}
							<code>entitlements.for(target)</code>. Reload: <code>source</code>{" "}
							moves from <code>api</code> to <code>cache</code>. Server-gated
							page: <Link href="/reports">/reports</Link>.
						</p>
					</section>

					<section>
						<h2>Browser</h2>
						<EntitlementsProvider key={user.id}>
							<BrowserChecks />
						</EntitlementsProvider>
					</section>
				</>
			) : (
				<p className="muted">
					Signed out. <code>/api/entitlements</code> answers 401.
				</p>
			)}
		</>
	);
}
