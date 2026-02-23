import { describe, expect, it } from "vitest";
import { CHARGEBEE_ERROR_CODES } from "../src/error-codes";

describe("error codes", () => {
	it("should have all error codes defined", () => {
		expect(CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED).toBeDefined();
		expect(CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND).toBeDefined();
		expect(CHARGEBEE_ERROR_CODES.PLAN_NOT_FOUND).toBeDefined();
		expect(CHARGEBEE_ERROR_CODES.CUSTOMER_NOT_FOUND).toBeDefined();
		expect(CHARGEBEE_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED).toBeDefined();
		expect(CHARGEBEE_ERROR_CODES.UNAUTHORIZED_REFERENCE).toBeDefined();
		expect(CHARGEBEE_ERROR_CODES.ORGANIZATION_NOT_FOUND).toBeDefined();
		expect(
			CHARGEBEE_ERROR_CODES.ORGANIZATION_SUBSCRIPTION_NOT_ENABLED,
		).toBeDefined();
		expect(CHARGEBEE_ERROR_CODES.UNABLE_TO_CREATE_CUSTOMER).toBeDefined();
	});

	it("should be strings", () => {
		expect(typeof CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED).toBe("string");
		expect(typeof CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND).toBe("string");
		expect(typeof CHARGEBEE_ERROR_CODES.PLAN_NOT_FOUND).toBe("string");
	});

	it("should have unique values", () => {
		const codes = Object.values(CHARGEBEE_ERROR_CODES);
		const uniqueCodes = new Set(codes);
		expect(codes.length).toBe(uniqueCodes.size);
	});

	it("should have descriptive messages", () => {
		const codes = Object.values(CHARGEBEE_ERROR_CODES);
		for (const code of codes) {
			expect(code.length).toBeGreaterThan(10);
		}
	});
});
