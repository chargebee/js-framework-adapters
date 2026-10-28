import { switchUser } from "@/app/actions";
import { USER_FIELD } from "@/lib/session";
import type { UserProfile } from "@/lib/users";

/** Mock-mode switcher: each demo user with what the mock API grants them. */
export function UserProfiles({
	users,
	currentUserId,
}: {
	users: UserProfile[];
	currentUserId: string | undefined;
}) {
	return (
		<form action={switchUser}>
			<ul className="profiles">
				{users.map(({ id, name, description }) => {
					const current = id === currentUserId;
					return (
						<li key={id} className={current ? "current" : undefined}>
							<strong>{name}</strong>
							<p>{description}</p>
							<button
								type="submit"
								name={USER_FIELD}
								value={id}
								disabled={current}
							>
								{current ? "Signed in" : "Sign in"}
							</button>
						</li>
					);
				})}
			</ul>
			<button type="submit" disabled={!currentUserId}>
				Sign out
			</button>
		</form>
	);
}
