import { APIError, createAuthEndpoint } from "better-auth/api";
import type { ChargebeeOptions } from "./types";

export function getWebhookEndpoint(options: ChargebeeOptions) {
	return createAuthEndpoint(
		"/chargebee/webhook",
		{
			method: "POST",
			metadata: { isAction: false },
		},
		async (ctx) => {
			if (options.webhookUsername || options.webhookPassword) {
				const authHeader = ctx.request?.headers.get("authorization");
				if (
					!verifyBasicAuth(
						authHeader,
						options.webhookUsername,
						options.webhookPassword,
					)
				) {
					throw new APIError("UNAUTHORIZED", {
						message: "Webhook verification failed",
					});
				}
			}

			const event = ctx.body as any;
			const eventType = event?.event_type;
			const content = event?.content;
			console.log(eventType);

			if (!eventType || !content) {
				throw new APIError("BAD_REQUEST", {
					message: "Invalid webhook payload",
				});
			}
			await options.onEvent?.(event);
			return ctx.json({ received: true });
		},
	);
}

function verifyBasicAuth(
	header: string | null | undefined,
	expectedUser?: string,
	expectedPass?: string,
): boolean {
	if (!header?.startsWith("Basic ")) return false;
	const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
	const [user, pass] = decoded.split(":");

	if (expectedUser && user !== expectedUser) return false;
	if (expectedPass && pass !== expectedPass) return false;
	return true;
}
