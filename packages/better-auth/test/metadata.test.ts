import { describe, expect, it } from "vitest";
import { customerMetadata, subscriptionMetadata } from "../src/metadata";

describe("metadata - customerMetadata", () => {
	describe("set", () => {
		it("should set protected values for user customer", () => {
			const result = customerMetadata.set(undefined, {
				userId: "user_123",
				customerType: "user",
			});

			expect(result.userId).toBe("user_123");
			expect(result.customerType).toBe("user");
		});

		it("should set protected values for organization customer", () => {
			const result = customerMetadata.set(undefined, {
				userId: "user_123",
				customerType: "organization",
				organizationId: "org_456",
			});

			expect(result.userId).toBe("user_123");
			expect(result.customerType).toBe("organization");
			expect(result.organizationId).toBe("org_456");
		});

		it("should merge user metadata with protected values", () => {
			const userMetadata = {
				customField: "custom_value",
				anotherField: "another_value",
			};

			const result = customerMetadata.set(userMetadata, {
				userId: "user_123",
				customerType: "user",
			});

			expect(result.userId).toBe("user_123");
			expect(result.customerType).toBe("user");
			expect(result.customField).toBe("custom_value");
			expect(result.anotherField).toBe("another_value");
		});

		it("should override userId if present in user metadata", () => {
			const userMetadata = {
				userId: "old_user_id",
				customField: "custom_value",
			};

			const result = customerMetadata.set(userMetadata, {
				userId: "new_user_123",
				customerType: "user",
			});

			expect(result.userId).toBe("new_user_123");
			expect(result.customField).toBe("custom_value");
		});

		it("should not add organizationId if not provided", () => {
			const result = customerMetadata.set(undefined, {
				userId: "user_123",
				customerType: "user",
			});

			expect(result).not.toHaveProperty("organizationId");
		});
	});

	describe("get", () => {
		it("should extract userId and customerType from metadata", () => {
			const metadata = {
				userId: "user_123",
				customerType: "user",
				extra: "ignored",
			};

			const result = customerMetadata.get(metadata);

			expect(result.userId).toBe("user_123");
			expect(result.customerType).toBe("user");
			expect(result.organizationId).toBeUndefined();
			expect(result).not.toHaveProperty("extra");
		});

		it("should extract organizationId if present", () => {
			const metadata = {
				userId: "user_123",
				customerType: "organization",
				organizationId: "org_456",
			};

			const result = customerMetadata.get(metadata);

			expect(result.userId).toBe("user_123");
			expect(result.customerType).toBe("organization");
			expect(result.organizationId).toBe("org_456");
		});

		it("should handle undefined metadata", () => {
			const result = customerMetadata.get(undefined);

			expect(result.userId).toBeUndefined();
			expect(result.customerType).toBeUndefined();
			expect(result.organizationId).toBeUndefined();
		});

		it("should handle empty metadata object", () => {
			const result = customerMetadata.get({});

			expect(result.userId).toBeUndefined();
			expect(result.customerType).toBeUndefined();
			expect(result.organizationId).toBeUndefined();
		});
	});
});

describe("metadata - subscriptionMetadata", () => {
	describe("set", () => {
		it("should set subscription values", () => {
			const result = subscriptionMetadata.set(undefined, {
				referenceId: "user_123",
				subscriptionId: "sub_456",
				plan: "pro-plan",
			});

			expect(result.referenceId).toBe("user_123");
			expect(result.subscriptionId).toBe("sub_456");
			expect(result.plan).toBe("pro-plan");
		});

		it("should merge user metadata with subscription values", () => {
			const userMetadata = {
				customField: "custom_value",
				anotherField: "another_value",
			};

			const result = subscriptionMetadata.set(userMetadata, {
				referenceId: "user_123",
				subscriptionId: "sub_456",
				plan: "pro-plan",
			});

			expect(result.referenceId).toBe("user_123");
			expect(result.subscriptionId).toBe("sub_456");
			expect(result.plan).toBe("pro-plan");
			expect(result.customField).toBe("custom_value");
			expect(result.anotherField).toBe("another_value");
		});

		it("should override subscription fields if present in user metadata", () => {
			const userMetadata = {
				referenceId: "old_user",
				subscriptionId: "old_sub",
				plan: "old_plan",
			};

			const result = subscriptionMetadata.set(userMetadata, {
				referenceId: "new_user_123",
				subscriptionId: "new_sub_456",
				plan: "new-pro-plan",
			});

			expect(result.referenceId).toBe("new_user_123");
			expect(result.subscriptionId).toBe("new_sub_456");
			expect(result.plan).toBe("new-pro-plan");
		});
	});

	describe("get", () => {
		it("should extract subscription fields from metadata", () => {
			const metadata = {
				referenceId: "user_123",
				subscriptionId: "sub_456",
				plan: "pro-plan",
				extra: "ignored",
			};

			const result = subscriptionMetadata.get(metadata);

			expect(result.referenceId).toBe("user_123");
			expect(result.subscriptionId).toBe("sub_456");
			expect(result.plan).toBe("pro-plan");
			expect(result).not.toHaveProperty("extra");
		});

		it("should handle undefined metadata", () => {
			const result = subscriptionMetadata.get(undefined);

			expect(result.referenceId).toBeUndefined();
			expect(result.subscriptionId).toBeUndefined();
			expect(result.plan).toBeUndefined();
		});

		it("should handle empty metadata object", () => {
			const result = subscriptionMetadata.get({});

			expect(result.referenceId).toBeUndefined();
			expect(result.subscriptionId).toBeUndefined();
			expect(result.plan).toBeUndefined();
		});
	});
});
