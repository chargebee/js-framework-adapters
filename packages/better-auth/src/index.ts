import type { BetterAuthPlugin } from "better-auth";
import { getSchema } from "./schema";
import type { ChargebeeOptions } from "./types";

export const chargebee = (options: ChargebeeOptions) => {
	return {
		id: "chargebee",
		schema: getSchema(options),
		endpoints: {},
		init(ctx) {
			return { options: {} };
		},
	} satisfies BetterAuthPlugin;
};
