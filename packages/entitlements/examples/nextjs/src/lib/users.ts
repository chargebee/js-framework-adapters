import "server-only";

export interface User {
	id: string;
	name: string;
	/** What the mock API grants this user; your own site's data will differ. */
	description: string;
	chargebeeCustomerId: string;
}

export type UserProfile = Omit<User, "chargebeeCustomerId">;

/**
 * Stands in for your user table. With real credentials, point
 * `chargebeeCustomerId` at customers in your Chargebee site.
 */
const USERS: User[] = [
	{
		id: "alice",
		name: "Alice, Pro plan",
		description:
			"Advanced reports, 25 seats, unlimited API calls, and priority support.",
		chargebeeCustomerId: "cust_pro",
	},
	{
		id: "bob",
		name: "Bob, Free plan",
		description:
			"Advanced reports disabled, 3 seats, and 1,000 API calls. Has no support tier, so it falls back to the default.",
		chargebeeCustomerId: "cust_free",
	},
	{
		id: "carol",
		name: "Carol, not a customer",
		description:
			"Missing from Chargebee. The server falls back to defaults and the relay answers 502.",
		chargebeeCustomerId: "cust_missing",
	},
];

export function findUser(id: string | undefined): User | undefined {
	return USERS.find((user) => user.id === id);
}

/** Without customer IDs, which never reach the browser. */
export function listUsers(): UserProfile[] {
	return USERS.map(({ id, name, description }) => ({ id, name, description }));
}
