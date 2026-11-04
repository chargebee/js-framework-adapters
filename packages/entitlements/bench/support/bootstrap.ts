import type Chargebee from "chargebee";
import { CUSTOMER_COUNT, customerId } from "./config";

/**
 * Creates the fixtures the benchmarks read from a Chargebee test site.
 * Every step creates its resource only when missing, so a run can recreate
 * whatever was deleted. Runs may overlap (e.g. locally and on ECS against the
 * same site), so a failed creation counts as success when the resource exists
 * afterwards.
 *
 *   benchmark_family
 *   └─ benchmark_plan ($0/month, entitlements below)
 *       └─ benchmark_plan_monthly
 *           └─ benchmark_subscription_N ◄── benchmark_customer_N
 */

const HTTP_NOT_FOUND = 404;

const FAMILY_ID = "benchmark_family";
const PLAN_ID = "benchmark_plan";
const PLAN_PRICE_ID = "benchmark_plan_monthly";

export const LIVE_SEATS_FEATURE_ID = "benchmark_licensed_seats";

/** What a step did, so the log shows what was missing. */
enum Outcome {
	Created = "created",
	Exists = "exists",
	Updated = "updated",
}

export type Log = (message: string) => void;

type FeatureType = "switch" | "quantity" | "custom";

interface FeatureFixture {
	id: string;
	name: string;
	type: FeatureType;
	unit?: string;
	// Non-switch features need at least two; the entitlement value must be one.
	levels?: string[];
	value: string;
}

const FEATURES: FeatureFixture[] = [
	{
		id: "benchmark_advanced_reports",
		name: "Advanced reports",
		type: "switch",
		value: "true",
	},
	{
		id: LIVE_SEATS_FEATURE_ID,
		name: "Licensed seats",
		type: "quantity",
		unit: "seat",
		levels: ["10", "25"],
		value: "25",
	},
	{
		id: "benchmark_support_tier",
		name: "Support tier",
		type: "custom",
		levels: ["standard", "priority"],
		value: "priority",
	},
];

function subscriptionId(index: number): string {
	return `benchmark_subscription_${index}`;
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"http_status_code" in error &&
		error.http_status_code === HTTP_NOT_FOUND
	);
}

/** Runs `lookup`; a 404 means the resource is missing. */
async function find<T>(lookup: () => Promise<T>): Promise<T | undefined> {
	try {
		return await lookup();
	} catch (error) {
		if (isNotFound(error)) {
			return undefined;
		}

		throw error;
	}
}

/**
 * Creates the resource unless `lookup` finds it. A creation that fails while
 * the resource now exists lost a race to another run, which is fine.
 */
async function ensure<T>(
	lookup: () => Promise<T>,
	create: () => Promise<unknown>,
): Promise<Outcome> {
	if (await find(lookup)) {
		return Outcome.Exists;
	}

	try {
		await create();
	} catch (error) {
		if (await find(lookup)) {
			return Outcome.Exists;
		}

		throw error;
	}

	return Outcome.Created;
}

function ensureFamily(chargebee: Chargebee): Promise<Outcome> {
	return ensure(
		() => chargebee.itemFamily.retrieve(FAMILY_ID),
		() => chargebee.itemFamily.create({ id: FAMILY_ID, name: "Benchmark" }),
	);
}

async function featureStatus(
	chargebee: Chargebee,
	id: string,
): Promise<string | undefined> {
	return (await find(() => chargebee.feature.retrieve(id)))?.feature.status;
}

/** Runs the activation; failing because a concurrent run activated it is fine. */
async function settleActive(
	chargebee: Chargebee,
	id: string,
	activate: () => Promise<unknown>,
): Promise<void> {
	try {
		await activate();
	} catch (error) {
		if ((await featureStatus(chargebee, id)) === "active") {
			return;
		}

		throw error;
	}
}

/** Features are created as drafts; only active ones can carry entitlements. */
async function ensureFeature(
	chargebee: Chargebee,
	fixture: FeatureFixture,
): Promise<Outcome> {
	const status = await featureStatus(chargebee, fixture.id);
	if (status === "active") {
		return Outcome.Exists;
	}

	if (status === "archived") {
		await settleActive(chargebee, fixture.id, () =>
			chargebee.feature.reactivate(fixture.id),
		);
		return Outcome.Updated;
	}

	if (status === undefined) {
		try {
			await chargebee.feature.create({
				id: fixture.id,
				name: fixture.name,
				type: fixture.type,
				unit: fixture.unit,
				levels: fixture.levels?.map((value, index) => ({
					value,
					level: index + 1,
				})),
			});
		} catch (error) {
			// A concurrent run may have created, or even activated, it already.
			const current = await featureStatus(chargebee, fixture.id);
			if (current === undefined) {
				throw error;
			}

			if (current === "active") {
				return Outcome.Exists;
			}
		}
	}

	await settleActive(chargebee, fixture.id, () =>
		chargebee.feature.activate(fixture.id),
	);
	return status === undefined ? Outcome.Created : Outcome.Updated;
}

function ensurePlan(chargebee: Chargebee): Promise<Outcome> {
	return ensure(
		() => chargebee.item.retrieve(PLAN_ID),
		() =>
			chargebee.item.create({
				id: PLAN_ID,
				name: "Benchmark plan",
				type: "plan",
				item_family_id: FAMILY_ID,
			}),
	);
}

// Upsert is idempotent, so it runs every time instead of probing first.
async function upsertEntitlements(chargebee: Chargebee): Promise<Outcome> {
	await chargebee.entitlement.create({
		action: "upsert",
		entitlements: FEATURES.map((feature) => ({
			entity_id: PLAN_ID,
			entity_type: "plan",
			feature_id: feature.id,
			value: feature.value,
		})),
	});
	return Outcome.Updated;
}

/** Prices must name a currency; the site's base one is always enabled. */
async function baseCurrency(chargebee: Chargebee): Promise<string> {
	const { list } = await chargebee.currency.list();
	const base = list.find((item) => item.currency.is_base_currency);
	if (!base) {
		throw new Error("The Chargebee site has no base currency");
	}

	return base.currency.currency_code;
}

function ensurePlanPrice(chargebee: Chargebee): Promise<Outcome> {
	return ensure(
		() => chargebee.itemPrice.retrieve(PLAN_PRICE_ID),
		async () =>
			chargebee.itemPrice.create({
				id: PLAN_PRICE_ID,
				name: "Benchmark plan monthly",
				item_id: PLAN_ID,
				currency_code: await baseCurrency(chargebee),
				pricing_model: "flat_fee",
				price: 0,
				period_unit: "month",
				period: 1,
			}),
	);
}

function ensureCustomer(chargebee: Chargebee, index: number): Promise<Outcome> {
	const id = customerId(index);
	return ensure(
		() => chargebee.customer.retrieve(id),
		() =>
			chargebee.customer.create({
				id,
				first_name: "Benchmark",
				last_name: `Customer ${index}`,
				auto_collection: "off",
			}),
	);
}

function ensureSubscription(
	chargebee: Chargebee,
	index: number,
): Promise<Outcome> {
	const id = subscriptionId(index);
	return ensure(
		() => chargebee.subscription.retrieve(id),
		() =>
			chargebee.subscription.createWithItems(customerId(index), {
				id,
				subscription_items: [{ item_price_id: PLAN_PRICE_ID, quantity: 1 }],
			}),
	);
}

/** Logs a step before it starts, so a failure shows where it stopped. */
async function step(
	log: Log,
	label: string,
	run: () => Promise<Outcome>,
): Promise<void> {
	log(`[bootstrap] ${label} ...`);
	const outcome = await run();
	log(`[bootstrap] ${label}: ${outcome}`);
}

/** Calls run in sequence: each step depends on the previous, and it's a one-off. */
export async function ensureBenchFixtures(
	chargebee: Chargebee,
	log: Log = console.log,
): Promise<void> {
	await step(log, `item family ${FAMILY_ID}`, () => ensureFamily(chargebee));

	for (const feature of FEATURES) {
		await step(log, `feature ${feature.id}`, () =>
			ensureFeature(chargebee, feature),
		);
	}

	await step(log, `plan ${PLAN_ID}`, () => ensurePlan(chargebee));
	await step(log, "plan entitlements", () => upsertEntitlements(chargebee));
	await step(log, `plan price ${PLAN_PRICE_ID}`, () =>
		ensurePlanPrice(chargebee),
	);

	for (let index = 1; index <= CUSTOMER_COUNT; index += 1) {
		await step(log, `customer ${customerId(index)}`, () =>
			ensureCustomer(chargebee, index),
		);
		await step(log, `subscription ${subscriptionId(index)}`, () =>
			ensureSubscription(chargebee, index),
		);
	}

	log("[bootstrap] done");
}
