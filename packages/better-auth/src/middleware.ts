import { APIError, getSessionFromCtx } from "better-auth/api";
import { createAuthMiddleware } from "better-auth/plugins";

// Ensures the user is authenticated
export const sessionMiddleware = createAuthMiddleware(async (ctx) => {
	const session = await getSessionFromCtx(ctx);
	if (!session) {
		throw new APIError("UNAUTHORIZED", { message: "Session required" });
	}
	return { session };
});

// Authorizes the referenceId (user or org)
export const referenceMiddleware = (authorizeReference?: Function) =>
	createAuthMiddleware(async (ctx) => {
		const session = ctx.context.session;
		const body = ctx.body as any;
		const referenceId = body?.referenceId || session?.user.id;
		const action = ctx.path;

		if (authorizeReference) {
			const authorized = await authorizeReference({
				user: session?.user,
				session: session?.session,
				referenceId,
				action,
			});
			if (!authorized) {
				throw new APIError("FORBIDDEN", {
					message: "Not authorized for this reference",
				});
			}
		} else {
			// Default: only allow operations on own user ID
			if (referenceId !== session?.user.id) {
				throw new APIError("FORBIDDEN", {
					message: "Not authorized for this reference",
				});
			}
		}

		return { referenceId };
	});
