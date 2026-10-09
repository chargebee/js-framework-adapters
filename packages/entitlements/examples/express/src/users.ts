export interface User {
	id: string;
	name: string;
	/** What the mock API grants this user; your own site's data will differ. */
	description: string;
	chargebeeCustomerId: string;
	teamSize: number;
}

/**
 * Stands in for your user table. With real credentials, point
 * `chargebeeCustomerId` at customers in your Chargebee site.
 */
const USERS: User[] = [
	{
		id: "alice",
		name: "Alice, Pro plan",
		description:
			"Advanced reports, 25 seats (4 used), unlimited API calls, and priority support.",
		chargebeeCustomerId: "cust_pro",
		teamSize: 4,
	},
	{
		id: "bob",
		name: "Bob, Free plan",
		description:
			"Advanced reports disabled, 3 seats all used, and 1,000 API calls. Has no support tier, so it falls back to the default.",
		chargebeeCustomerId: "cust_free",
		teamSize: 3,
	},
	{
		id: "carol",
		name: "Carol, not a customer",
		description:
			"Missing from Chargebee. Every feature falls back to its lowest-tier default.",
		chargebeeCustomerId: "cust_missing",
		teamSize: 0,
	},
];

export const USER_IDS = USERS.map((user) => user.id);

export function findUser(id: string | undefined): User | undefined {
	return USERS.find((user) => user.id === id);
}

export function listUsers(): readonly User[] {
	return USERS;
}
