// Common post install setup
export const postInstallMsg = `Please complete the following steps before you test out the Chargebee integration:

1. Define the required process.env.* variables either by adding them to your .env file or 
replacing them at build time
	CHARGEBEE_API_KEY=""
	CHARGEBEE_SITE="site-name"
	CHARGEBEE_WEBHOOK_AUTH="username:password"

2. Run npm|pnpm|bun install to grab the required packages

3. Configure the webhook URL in the Chargebee dashboard with the path: /chargebee/webhook 
and basic auth set to the username and password defined in CHARGEBEE_WEBHOOK_AUTH`;
