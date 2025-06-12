export const cliHelpMsg = (version: string, description: string) => `
chargebee-init v${version}

${description}. Supports these popular frameworks:

Next.js v15
Express v5

And these features using the Chargebee Node SDK:

Checkout (Hosted Pages): One time, subscription and manage payment method
Webhook: Incoming webhooks
`;

const commonPostInit = `Please complete the following steps before you test out the Chargebee integration:

* Define the required process.env.* variables either by adding them to your .env file or replacing them at build time:

	CHARGEBEE_SITE="site-name"
	CHARGEBEE_API_KEY=""
	CHARGEBEE_WEBHOOK_AUTH="username:password"

* Run npm|pnpm|bun install to grab the required packages

* Configure the webhook URL in the Chargebee dashboard with the path: /chargebee/webhook and basic auth set to the username and password defined in CHARGEBEE_WEBHOOK_AUTH
`;

export const messages = {
	nextjs: {
		preinit: `
* --------------------------
* Chargebee Next.js Adapter
* --------------------------
* Integrates with Next.js version 15 
* Only App Router is supported at the moment
* Routes will be created under the chargebee directory by default
`,
		postinit: `
${commonPostInit}
* Review the routes created under the chargebee/ directory and make necessary changes
`,
	},
	express: {
		preinit: `
* --------------------------
* Chargebee Express Adapter
* --------------------------
* Integrates with Express version 5
`,
		postinit: `
${commonPostInit}
* Review chargebee/controllers.ts and make necessary changes

* Wire up the routes in your express app:

	import chargebeeInit from "./chargebee/controllers.ts"
	chargebeeInit(app);
`,
	},
} as const;
