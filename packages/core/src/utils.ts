export function validateApiAuth(apiKey: string, site: string) {
	if (!apiKey || !site) {
		throw new Error(
			`apiKey and site passed to the Chargebee client are required parameters`,
		);
	}
}

function splitUserPass(input: string = ""): string[] {
	const parts = input.split(":");
	const user = parts[0] ?? "";
	const pass = parts.slice(1).join(":");
	return [user, pass];
}

export function validateBasicAuth(
	webhookUserPass: string | undefined,
	authHeader: string | null | undefined,
) {
	const [WEBHOOK_USER, WEBHOOK_PASS] = splitUserPass(webhookUserPass);
	if (!WEBHOOK_USER || !WEBHOOK_PASS) {
		throw new Error(
			`Username and password to validate against is not in the expected "user:pass" format`,
		);
	}

	if (!authHeader) {
		throw new Error(`Incoming webhook request has no Authorization header`);
	}

	const [user, pass] = splitUserPass(
		Buffer.from(authHeader, "base64").toString(),
	);
	if (!(user === WEBHOOK_USER && pass === WEBHOOK_PASS)) {
		throw new Error(`Incoming webhook authorization failed`);
	}
}
