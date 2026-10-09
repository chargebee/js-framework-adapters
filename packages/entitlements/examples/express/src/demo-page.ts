import type { User } from "./users.ts";

export interface FeatureSummary {
	featureId: string;
	value: unknown;
	status: string;
	source?: string;
	error?: string;
}

interface DemoPageOptions {
	users: readonly User[];
	user: User | undefined;
	features: FeatureSummary[];
	userField: string;
}

/** An API route the page can call, with its response shown below the buttons. */
interface ApiAction {
	method: "GET" | "POST";
	url: string;
	body?: string;
}

const STYLES = `
body { margin: 0; font-family: system-ui, sans-serif; color: #1f2328; background: #f6f8fa; }
main { max-width: 760px; margin: 0 auto; padding: 2rem 1rem; }
section { margin-top: 1.5rem; padding: 1rem 1.25rem; background: #fff; border: 1px solid #d0d7de; border-radius: 8px; }
h2 { margin-top: 0; font-size: 1.1rem; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 0.4rem 0.5rem; text-align: left; border-bottom: 1px solid #eaeef2; }
button { margin: 0 0.5rem 0.5rem 0; padding: 0.35rem 0.8rem; cursor: pointer; }
pre { padding: 0.75rem; background: #f6f8fa; border-radius: 6px; overflow-x: auto; }
.profiles { margin: 0 0 1rem; padding: 0; list-style: none; }
.profiles li { margin-bottom: 0.5rem; padding: 0.6rem 0.8rem; border: 1px solid #d0d7de; border-radius: 6px; }
.profiles li.current { border-color: #1a7f37; background: #f0fff4; }
.profiles p { margin: 0.25rem 0 0.5rem; }
.notice { padding: 0.6rem 1rem; background: #fff8c5; border: 1px solid #d4a72c; border-radius: 8px; }
.muted { color: #656d76; }
.granted { color: #1a7f37; }
.disabled, .error { color: #cf222e; }
`;

/** Sends each action's request and prints the status and JSON body. */
const SCRIPT = `
const output = document.getElementById("output");
for (const button of document.querySelectorAll("[data-url]")) {
	button.addEventListener("click", async () => {
		const { method, url, body } = button.dataset;
		const headers = body ? { "Content-Type": "application/json" } : {};
		const response = await fetch(url, { method, headers, body });
		const text = await response.text();
		let pretty = text;
		try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch {}
		output.textContent = method + " " + url + " → " + response.status + "\\n\\n" + pretty;
	});
}
`;

const escapeHtml = (value: unknown) =>
	String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function renderProfiles(options: DemoPageOptions): string {
	const items = options.users
		.map((user) => {
			const current = user.id === options.user?.id;
			return `<li class="${current ? "current" : ""}">
	<strong>${escapeHtml(user.name)}</strong>
	<p>${escapeHtml(user.description)}</p>
	<button name="${options.userField}" value="${escapeHtml(user.id)}" ${current ? "disabled" : ""}>
		${current ? "Signed in" : "Sign in"}
	</button>
</li>`;
		})
		.join("\n");

	return `<form method="post" action="/session">
	<ul class="profiles">${items}</ul>
	<button ${options.user ? "" : "disabled"}>Sign out</button>
</form>`;
}

function renderFeatures(features: FeatureSummary[]): string {
	const rows = features
		.map(
			(feature) => `<tr>
	<td><code>${escapeHtml(feature.featureId)}</code></td>
	<td>${escapeHtml(feature.value)}</td>
	<td class="${escapeHtml(feature.status)}" title="${escapeHtml(feature.error ?? "")}">${escapeHtml(feature.status)}</td>
	<td class="muted">${escapeHtml(feature.source ?? "none")}</td>
</tr>`,
		)
		.join("\n");

	return `<table>
	<thead><tr><th>Feature</th><th>Value</th><th>Status</th><th>Source</th></tr></thead>
	<tbody>${rows}</tbody>
</table>`;
}

function renderActions(user: User): string {
	// The webhook a subscription change for this user's customer would send.
	const webhookBody = JSON.stringify({
		event_type: "subscription_changed",
		content: { subscription: { customer_id: user.chargebeeCustomerId } },
	});
	const actions: ApiAction[] = [
		{ method: "GET", url: "/me/entitlements" },
		{ method: "GET", url: "/reports" },
		{ method: "POST", url: "/team/members" },
		{ method: "POST", url: "/webhooks/chargebee", body: webhookBody },
	];

	const buttons = actions
		.map(
			(action) =>
				`<button type="button" data-method="${action.method}" data-url="${action.url}"${
					action.body ? ` data-body="${escapeHtml(action.body)}"` : ""
				}>${action.method} ${action.url}</button>`,
		)
		.join("\n");

	return `${buttons}
<pre id="output" class="muted">Pick a request.</pre>`;
}

/** The mock-mode page: switch demo users and call the API from the browser. */
export function renderDemoPage(options: DemoPageOptions): string {
	const { user } = options;
	const signedIn = user
		? `<section>
	<h2>Entitlements of ${escapeHtml(user.name)}</h2>
	${renderFeatures(options.features)}
	<p class="muted">Reload: <code>source</code> moves from <code>api</code> to <code>cache</code>.</p>
</section>
<section>
	<h2>Try the API</h2>
	${renderActions(user)}
</section>`
		: `<p class="muted">Sign in as a demo user to see their entitlements.</p>`;

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>Chargebee entitlements, Express example</title>
	<style>${STYLES}</style>
</head>
<body>
<main>
	<h1>Chargebee entitlements</h1>
	<p>Express.js example - server side checks only</p>
	<p class="notice">No Chargebee credentials in <code>.env</code>: answering from the mock API.</p>
	<section>
		<h2>Demo users</h2>
		${renderProfiles(options)}
	</section>
	${signedIn}
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}
