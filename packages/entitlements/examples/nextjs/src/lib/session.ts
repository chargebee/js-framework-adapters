import "server-only";

import { cookies } from "next/headers";
import { findUser, type User } from "./users";

const SESSION_COOKIE = "demo-user";

/** Form field the user switcher submits. */
export const USER_FIELD = "userId";

/** Stand-in for real auth: a cookie naming a demo user. */
export async function getSessionUser(): Promise<User | null> {
	const store = await cookies();
	return findUser(store.get(SESSION_COOKIE)?.value) ?? null;
}

export async function setSessionUser(userId: string | null): Promise<void> {
	const store = await cookies();
	if (!userId) {
		store.delete(SESSION_COOKIE);
		return;
	}

	store.set(SESSION_COOKIE, userId, { httpOnly: true, sameSite: "lax" });
}
