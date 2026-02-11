import type { BetterAuthClientPlugin } from "better-auth/client";
import { CHARGEBEE_ERROR_CODES } from "./error-codes";
import type { chargebee } from "./index";

export const chargebeeClient = <
	O extends {
		subscription: boolean;
	},
>(
	_options?: O | undefined,
) => {
	const plugin = {
		id: "chargebee-client",
		$InferServerPlugin: {} as ReturnType<
			typeof chargebee<
				O["subscription"] extends true
					? {
							chargebeeClient: any;
							webhookUsername?: string;
							webhookPassword?: string;
							subscription: {
								enabled: true;
								plans: [];
							};
						}
					: {
							chargebeeClient: any;
							webhookUsername?: string;
							webhookPassword?: string;
						}
			>
		>,
		pathMethods: {
			"/subscription/cancel": "POST",
		},
	} satisfies BetterAuthClientPlugin;

	return {
		...plugin,
		$ERROR_CODES: CHARGEBEE_ERROR_CODES,
	};
};

export * from "./error-codes";
