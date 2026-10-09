"use server";

import { setSessionUser, USER_FIELD } from "@/lib/session";

/** Signs in as the submitted demo user, or out when none is submitted. */
export async function switchUser(formData: FormData): Promise<void> {
	const userId = formData.get(USER_FIELD);
	await setSessionUser(typeof userId === "string" ? userId : null);
}
