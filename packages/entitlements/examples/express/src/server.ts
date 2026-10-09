import type {
	ChargebeeTarget,
	EntitlementDetails,
	Feature,
	TargetedEntitlementsClient,
} from "@chargebee/entitlements";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { isMockChargebee } from "./chargebee.ts";
import { type FeatureSummary, renderDemoPage } from "./demo-page.ts";
import {
	advancedReports,
	entitlements,
	FEATURES,
	licensedSeats,
} from "./entitlements.ts";
import { findUser, listUsers, USER_IDS, type User } from "./users.ts";

const PORT = Number(process.env.PORT ?? 3000);
const USER_HEADER = "x-user";
const SESSION_COOKIE = "demo-user";
const USER_FIELD = "userId";

const HttpStatus = {
	Ok: 200,
	Created: 201,
	SeeOther: 303,
	Unauthorized: 401,
	Forbidden: 403,
} as const;

/** Chargebee events that can change a customer's entitlements. */
const ENTITLEMENT_EVENTS = new Set([
	"subscription_created",
	"subscription_changed",
	"subscription_cancelled",
	"subscription_reactivated",
	"subscription_entitlements_updated",
]);

interface AuthLocals {
	user: User;
	target: ChargebeeTarget;
}

type AuthResponse = Response<unknown, AuthLocals>;

/** `Infinity` (an "unlimited" entitlement) would serialize to `null`. */
const formatValue = (value: unknown) =>
	value === Number.POSITIVE_INFINITY ? "unlimited" : value;

const summarize = (
	featureId: string,
	details: EntitlementDetails<unknown>,
): FeatureSummary => ({
	featureId,
	value: formatValue(details.value),
	status: details.status,
	source: details.source,
	error: details.error?.message,
});

/** Every feature with its value and why: granted, disabled, or an error. */
function summarizeFeatures(target: ChargebeeTarget): Promise<FeatureSummary[]> {
	return Promise.all(
		FEATURES.map(async (feature) =>
			summarize(feature.featureId, await feature.getDetails(target)),
		),
	);
}

/** Reads one cookie; `cookie-parser` would do this in a larger app. */
function readCookie(req: Request, name: string): string | undefined {
	const cookie = req
		.header("cookie")
		?.split(";")
		.map((part) => part.trim().split("="))
		.find(([key]) => key === name);

	return cookie?.[1] ? decodeURIComponent(cookie[1]) : undefined;
}

/**
 * Stand-in for real auth: the `x-user` header names a demo user. With mock
 * data, the browser page's session cookie works too.
 */
function sessionUser(req: Request): User | undefined {
	const header = req.header(USER_HEADER);
	if (header || !isMockChargebee) {
		return findUser(header);
	}

	return findUser(readCookie(req, SESSION_COOKIE));
}

function authenticate(req: Request, res: AuthResponse, next: NextFunction) {
	const user = sessionUser(req);
	if (!user) {
		res.status(HttpStatus.Unauthorized).json({
			error: `Send an ${USER_HEADER} header, one of: ${USER_IDS.join(", ")}`,
		});
		return;
	}

	res.locals.user = user;
	res.locals.target = { customerId: user.chargebeeCustomerId };
	next();
}

/** Rejects the request unless the customer is entitled to `feature`. */
function requireFeature(feature: Feature<boolean, TargetedEntitlementsClient>) {
	return async (_req: Request, res: AuthResponse, next: NextFunction) => {
		if (await feature.get(res.locals.target)) {
			next();
			return;
		}

		res.status(HttpStatus.Forbidden).json({
			error: `Your plan does not include ${feature.featureId}`,
		});
	};
}

const app = express();

/** Usage hints, with one curl line per demo user. */
function usageText(): string {
	const users = listUsers()
		.map((user) => `  ${user.id.padEnd(6)} ${user.name}`)
		.join("\n");

	return `Chargebee entitlements, Express example

Users (send as the ${USER_HEADER} header):
${users}

Try:
  curl -H "${USER_HEADER}: alice" localhost:${PORT}/me/entitlements
  curl -H "${USER_HEADER}: bob" localhost:${PORT}/reports
  curl -X POST -H "${USER_HEADER}: bob" localhost:${PORT}/team/members
  curl -X POST -H "Content-Type: application/json" \\
    -d '{"event_type":"subscription_changed","content":{"subscription":{"customer_id":"cust_pro"}}}' \\
    localhost:${PORT}/webhooks/chargebee
`;
}

// With mock data, a page to switch users and call the API from the browser.
// With your own site, the curl hints.
app.get("/", async (req, res) => {
	if (!isMockChargebee) {
		res.type("text").send(usageText());
		return;
	}

	const user = sessionUser(req);
	const features = user
		? await summarizeFeatures({ customerId: user.chargebeeCustomerId })
		: [];

	res.type("html").send(
		renderDemoPage({
			users: listUsers(),
			user,
			features,
			userField: USER_FIELD,
		}),
	);
});

// Signs the browser page in as the submitted demo user, or out without one.
if (isMockChargebee) {
	app.post("/session", express.urlencoded(), (req, res) => {
		const user = findUser(req.body?.[USER_FIELD]);
		if (user) {
			res.cookie(SESSION_COOKIE, user.id, { httpOnly: true, sameSite: "lax" });
		} else {
			res.clearCookie(SESSION_COOKIE);
		}

		res.redirect(HttpStatus.SeeOther, "/");
	});
}

app.get("/me/entitlements", authenticate, async (_req, res: AuthResponse) => {
	const { user, target } = res.locals;
	const features = (await summarizeFeatures(target)).map(
		({ featureId, ...summary }) => [featureId, summary],
	);

	res.json({ user: user.name, features: Object.fromEntries(features) });
});

// A switch feature gating a whole route.
app.get(
	"/reports",
	authenticate,
	requireFeature(advancedReports),
	(_req, res) => {
		res.json({ report: "Revenue by region", rows: [["APAC", 1200]] });
	},
);

// A quantity feature capping how many members a team can have.
app.post("/team/members", authenticate, async (_req, res: AuthResponse) => {
	const { user, target } = res.locals;
	const seats = await licensedSeats.get(target);
	if (user.teamSize >= seats) {
		res.status(HttpStatus.Forbidden).json({
			error: `All ${seats} licensed seats are taken`,
		});
		return;
	}

	user.teamSize += 1;
	res.status(HttpStatus.Created).json({
		teamSize: user.teamSize,
		seats: formatValue(seats),
	});
});

// Drops the cached snapshot and refetches it when a subscription changes.
// Production webhooks must verify the request, e.g. with basic auth.
app.post("/webhooks/chargebee", express.json(), async (req, res) => {
	const { event_type: eventType, content } = req.body ?? {};
	const customerId: string | undefined = content?.subscription?.customer_id;
	if (!ENTITLEMENT_EVENTS.has(eventType) || !customerId) {
		res.sendStatus(HttpStatus.Ok);
		return;
	}

	await entitlements.refreshSnapshot({ customerId });
	console.log(`[webhook] ${eventType}: refreshed ${customerId}`);
	res.sendStatus(HttpStatus.Ok);
});

const server = app.listen(PORT, () => {
	console.log(`Listening on http://localhost:${PORT}`);
});

// Stops in-flight background refreshes before exiting.
process.on("SIGINT", async () => {
	await entitlements.close();
	server.close();
});
