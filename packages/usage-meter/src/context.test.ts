import { describe, expect, it } from "vitest";
import { ContextStore, mergeContext } from "./context.js";

describe("ContextStore", () => {
	it("returns undefined outside any run()", () => {
		const store = new ContextStore();
		expect(store.get()).toBeUndefined();
	});

	it("exposes the active context inside run()", () => {
		const store = new ContextStore();
		store.run({ subscriptionId: "sub_a" }, () => {
			expect(store.get()).toMatchObject({ subscriptionId: "sub_a" });
		});
	});

	it("propagates the context across awaits", async () => {
		const store = new ContextStore();
		await store.run({ subscriptionId: "sub_a" }, async () => {
			await new Promise((r) => setTimeout(r, 5));
			expect(store.get()?.subscriptionId).toBe("sub_a");
		});
	});

	it("nested run() merges parent + child (child wins on subscriptionId)", () => {
		const store = new ContextStore();
		store.run(
			{
				subscriptionId: "sub_parent",
				properties: { env: "prod", feature: "from-parent" },
				requestId: "req-parent",
			},
			() => {
				store.run(
					{
						subscriptionId: "sub_child",
						properties: { feature: "from-child", custom: 42 },
					},
					() => {
						const ctx = store.get();
						expect(ctx?.subscriptionId).toBe("sub_child");
						expect(ctx?.requestId).toBe("req-parent");
						expect(ctx?.properties).toEqual({
							env: "prod",
							feature: "from-child",
							custom: 42,
						});
					},
				);
			},
		);
	});

	it("nested run() leaves the parent untouched after the child returns", () => {
		const store = new ContextStore();
		store.run({ subscriptionId: "sub_parent" }, () => {
			store.run({ subscriptionId: "sub_child" }, () => {
				expect(store.get()?.subscriptionId).toBe("sub_child");
			});
			expect(store.get()?.subscriptionId).toBe("sub_parent");
		});
	});

	it("propagates merged context across awaits within nested run()", async () => {
		const store = new ContextStore();
		await store.run(
			{ subscriptionId: "sub_parent", properties: { env: "prod" } },
			async () => {
				await store.run({ properties: { feature: "x" } }, async () => {
					await new Promise((r) => setTimeout(r, 5));
					expect(store.get()?.subscriptionId).toBe("sub_parent");
					expect(store.get()?.properties).toEqual({
						env: "prod",
						feature: "x",
					});
				});
			},
		);
	});
});

describe("mergeContext", () => {
	it("child fields override parent fields", () => {
		const merged = mergeContext(
			{ subscriptionId: "p", requestId: "rp", usageTimestampMs: 1 },
			{ subscriptionId: "c", requestId: "rc", usageTimestampMs: 2 },
		);
		expect(merged.subscriptionId).toBe("c");
		expect(merged.requestId).toBe("rc");
		expect(merged.usageTimestampMs).toBe(2);
	});

	it("parent fields are kept when child omits them", () => {
		const merged = mergeContext(
			{ subscriptionId: "p", requestId: "rp" },
			{ properties: { x: 1 } },
		);
		expect(merged.subscriptionId).toBe("p");
		expect(merged.requestId).toBe("rp");
	});

	it("merges properties shallowly (child keys win)", () => {
		const merged = mergeContext(
			{ properties: { env: "prod", feature: "from-parent" } },
			{ properties: { feature: "from-child", extra: 99 } },
		);
		expect(merged.properties).toEqual({
			env: "prod",
			feature: "from-child",
			extra: 99,
		});
	});

	it("returns undefined properties when neither side has any", () => {
		const merged = mergeContext(
			{ subscriptionId: "p" },
			{ subscriptionId: "c" },
		);
		expect(merged.properties).toBeUndefined();
	});

	it("includes parent-only properties when child has none", () => {
		const merged = mergeContext(
			{ properties: { env: "prod" } },
			{ subscriptionId: "c" },
		);
		expect(merged.properties).toEqual({ env: "prod" });
	});
});
