import type Chargebee from "chargebee";
import { ensureBenchFixtures } from "./bootstrap";

const HTTP_NOT_FOUND = 404;
const MIN_LEVELS = 2;
const BASE_CURRENCY = "AUD";

interface FeatureInput {
	id: string;
	type: string;
	levels?: Array<{ value: string }>;
}

const notFound = async () => {
	throw Object.assign(new Error("not found"), {
		http_status_code: HTTP_NOT_FOUND,
	});
};

/**
 * A resource that looks missing on lookup, then fails creation because another
 * run created it in between.
 */
function makeRacedResource(found: unknown) {
	let taken = false;
	return {
		retrieve: vi.fn(async () => {
			if (!taken) {
				return notFound();
			}

			return found;
		}),
		create: vi.fn(async () => {
			taken = true;
			throw new Error("id : already present");
		}),
	};
}

/** A Chargebee site with nothing on it; mirrors the API's feature rules. */
function makeEmptySite() {
	const created = async () => ({});

	const featureCreate = vi.fn(async (input: FeatureInput) => {
		const levels = input.levels?.length ?? 0;
		if (input.type !== "switch" && levels < MIN_LEVELS) {
			throw new Error(
				`Need to provide minimum two entitlements levels for ${input.type} type of feature.`,
			);
		}

		return {};
	});

	const itemPriceCreate = vi.fn(async (input: { currency_code?: string }) => {
		if (!input.currency_code) {
			throw new Error("currency_code : cannot be blank");
		}

		return {};
	});

	const currencyList = async () => ({
		list: [
			{ currency: { currency_code: "USD", is_base_currency: false } },
			{ currency: { currency_code: BASE_CURRENCY, is_base_currency: true } },
		],
	});

	const client = {
		currency: { list: currencyList },
		itemFamily: { retrieve: notFound, create: created },
		feature: { retrieve: notFound, create: featureCreate, activate: created },
		item: { retrieve: notFound, create: created },
		entitlement: { create: created },
		itemPrice: { retrieve: notFound, create: itemPriceCreate },
		customer: { retrieve: notFound, create: created },
		subscription: { retrieve: notFound, createWithItems: created },
	} as unknown as Chargebee;

	return { client, featureCreate, itemPriceCreate };
}

describe("ensureBenchFixtures", () => {
	it("gives non-switch features the levels Chargebee requires", async () => {
		const { client, featureCreate } = makeEmptySite();

		await ensureBenchFixtures(client, () => {});

		const leveled = featureCreate.mock.calls.filter(
			([input]) => input.type !== "switch",
		);
		expect(leveled.length).toBeGreaterThan(0);
	});

	it("prices the plan in the site's base currency", async () => {
		const { client, itemPriceCreate } = makeEmptySite();

		await ensureBenchFixtures(client, () => {});

		expect(itemPriceCreate).toHaveBeenCalledWith(
			expect.objectContaining({ currency_code: BASE_CURRENCY }),
		);
	});

	it("logs each step and what it did", async () => {
		const { client } = makeEmptySite();
		const log = vi.fn();

		await ensureBenchFixtures(client, log);

		expect(log).toHaveBeenCalledWith(
			"[bootstrap] item family benchmark_family: created",
		);
		expect(log).toHaveBeenLastCalledWith("[bootstrap] done");
	});

	it("treats a resource created by a concurrent run as existing", async () => {
		const { client } = makeEmptySite();
		const subscription = makeRacedResource({});
		Object.assign(client, {
			itemFamily: makeRacedResource({}),
			item: makeRacedResource({}),
			itemPrice: makeRacedResource({}),
			customer: makeRacedResource({}),
			subscription: {
				retrieve: subscription.retrieve,
				createWithItems: subscription.create,
			},
		});
		const log = vi.fn();

		await ensureBenchFixtures(client, log);

		expect(log).toHaveBeenCalledWith(
			"[bootstrap] item family benchmark_family: exists",
		);
		expect(log).toHaveBeenLastCalledWith("[bootstrap] done");
	});

	it("treats a feature created and activated concurrently as existing", async () => {
		const { client } = makeEmptySite();
		Object.assign(client, {
			feature: makeRacedResource({ feature: { status: "active" } }),
		});
		const log = vi.fn();

		await ensureBenchFixtures(client, log);

		expect(log).toHaveBeenCalledWith(
			"[bootstrap] feature benchmark_licensed_seats: exists",
		);
	});

	it("treats a feature activated concurrently as active", async () => {
		const { client } = makeEmptySite();
		let status = "draft";
		Object.assign(client, {
			feature: {
				retrieve: async () => ({ feature: { status } }),
				activate: async () => {
					status = "active";
					throw new Error("feature is already active");
				},
			},
		});

		await expect(ensureBenchFixtures(client, () => {})).resolves.not.toThrow();
	});

	it("rethrows when creation fails and the resource is still missing", async () => {
		const { client } = makeEmptySite();
		Object.assign(client, {
			itemFamily: {
				retrieve: notFound,
				create: async () => {
					throw new Error("quota exceeded");
				},
			},
		});

		await expect(ensureBenchFixtures(client, () => {})).rejects.toThrow(
			"quota exceeded",
		);
	});
});
