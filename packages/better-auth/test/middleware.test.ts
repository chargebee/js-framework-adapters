import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHARGEBEE_ERROR_CODES } from "../src/error-codes";
import { referenceMiddleware, sessionMiddleware } from "../src/middleware";
import type { ChargebeeCtxSession, SubscriptionOptions } from "../src/types";

describe("middleware - sessionMiddleware", () => {
	it("should be defined", () => {
		expect(sessionMiddleware).toBeDefined();
		expect(typeof sessionMiddleware).toBe("function");
	});
});

describe("middleware - referenceMiddleware", () => {
	const mockLogger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should throw UNAUTHORIZED when no session", async () => {
		const subscriptionOptions = {
			enabled: true,
		} as SubscriptionOptions;

		const middleware = referenceMiddleware(
			subscriptionOptions,
			"upgrade-subscription",
		);
		const mockCtx = {
			context: {
				session: null,
				logger: mockLogger,
			},
			body: {},
			query: {},
		} as never;

		await expect(middleware(mockCtx)).rejects.toThrow(APIError);
		await expect(middleware(mockCtx)).rejects.toMatchObject({
			message: CHARGEBEE_ERROR_CODES.UNAUTHORIZED_REFERENCE,
		});
	});

	it("should pass for user subscription without explicit referenceId", async () => {
		const subscriptionOptions = {
			enabled: true,
		} as SubscriptionOptions;

		const middleware = referenceMiddleware(
			subscriptionOptions,
			"upgrade-subscription",
		);
		const mockCtx = {
			context: {
				session: {
					user: { id: "user_123" },
					session: { id: "session_123" },
				} as ChargebeeCtxSession,
				logger: mockLogger,
			},
			body: {},
			query: {},
		} as never;

		await expect(middleware(mockCtx)).resolves.toBeUndefined();
	});

	it("should pass when referenceId matches user id", async () => {
		const subscriptionOptions = {
			enabled: true,
		} as SubscriptionOptions;

		const middleware = referenceMiddleware(
			subscriptionOptions,
			"upgrade-subscription",
		);
		const mockCtx = {
			context: {
				session: {
					user: { id: "user_123" },
					session: { id: "session_123" },
				} as ChargebeeCtxSession,
				logger: mockLogger,
			},
			body: { referenceId: "user_123" },
			query: {},
		} as never;

		await expect(middleware(mockCtx)).resolves.toBeUndefined();
	});

	it("should throw when referenceId provided but authorizeReference not defined", async () => {
		const subscriptionOptions = {
			enabled: true,
		} as SubscriptionOptions;

		const middleware = referenceMiddleware(
			subscriptionOptions,
			"upgrade-subscription",
		);
		const mockCtx = {
			context: {
				session: {
					user: { id: "user_123" },
					session: { id: "session_123" },
				} as ChargebeeCtxSession,
				logger: mockLogger,
			},
			body: { referenceId: "different_user_456" },
			query: {},
		} as never;

		await expect(middleware(mockCtx)).rejects.toThrow(APIError);
		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.stringContaining("referenceId into a subscription action"),
		);
	});

	it("should pass when referenceId provided and authorizeReference returns true", async () => {
		const subscriptionOptions = {
			enabled: true,
			authorizeReference: vi.fn().mockResolvedValue(true),
		} as SubscriptionOptions;

		const middleware = referenceMiddleware(
			subscriptionOptions,
			"upgrade-subscription",
		);
		const mockCtx = {
			context: {
				session: {
					user: { id: "user_123" },
					session: { id: "session_123" },
				} as ChargebeeCtxSession,
				logger: mockLogger,
			},
			body: { referenceId: "different_user_456" },
			query: {},
		} as never;

		await expect(middleware(mockCtx)).resolves.toBeUndefined();
		expect(subscriptionOptions.authorizeReference).toHaveBeenCalledWith(
			expect.objectContaining({
				user: mockCtx.context.session.user,
				session: mockCtx.context.session.session,
				referenceId: "different_user_456",
				action: "upgrade-subscription",
			}),
			expect.any(Object),
		);
	});

	it("should throw UNAUTHORIZED when authorizeReference returns false", async () => {
		const subscriptionOptions = {
			enabled: true,
			authorizeReference: vi.fn().mockResolvedValue(false),
		} as SubscriptionOptions;

		const middleware = referenceMiddleware(
			subscriptionOptions,
			"upgrade-subscription",
		);
		const mockCtx = {
			context: {
				session: {
					user: { id: "user_123" },
					session: { id: "session_123" },
				} as ChargebeeCtxSession,
				logger: mockLogger,
			},
			body: { referenceId: "different_user_456" },
			query: {},
		} as never;

		await expect(middleware(mockCtx)).rejects.toThrow(APIError);
		await expect(middleware(mockCtx)).rejects.toMatchObject({
			message: CHARGEBEE_ERROR_CODES.UNAUTHORIZED_REFERENCE,
		});
	});

	it("should require authorizeReference for organization subscriptions", async () => {
		const subscriptionOptions = {
			enabled: true,
		} as SubscriptionOptions;

		const middleware = referenceMiddleware(
			subscriptionOptions,
			"upgrade-subscription",
		);
		const mockCtx = {
			context: {
				session: {
					user: { id: "user_123" },
					session: { id: "session_123", activeOrganizationId: "org_456" },
				} as ChargebeeCtxSession,
				logger: mockLogger,
			},
			body: { customerType: "organization" },
			query: {},
		} as never;

		await expect(middleware(mockCtx)).rejects.toThrow(APIError);
		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.stringContaining(
				"Organization subscriptions require authorizeReference",
			),
		);
	});

	it("should pass organization subscription when authorizeReference returns true", async () => {
		const subscriptionOptions = {
			enabled: true,
			authorizeReference: vi.fn().mockResolvedValue(true),
		} as SubscriptionOptions;

		const middleware = referenceMiddleware(
			subscriptionOptions,
			"upgrade-subscription",
		);
		const mockCtx = {
			context: {
				session: {
					user: { id: "user_123" },
					session: { id: "session_123", activeOrganizationId: "org_456" },
				} as ChargebeeCtxSession,
				logger: mockLogger,
			},
			body: { customerType: "organization" },
			query: {},
		} as never;

		await expect(middleware(mockCtx)).resolves.toBeUndefined();
		expect(subscriptionOptions.authorizeReference).toHaveBeenCalledWith(
			expect.objectContaining({
				user: mockCtx.context.session.user,
				session: mockCtx.context.session.session,
				referenceId: "org_456",
				action: "upgrade-subscription",
			}),
			expect.any(Object),
		);
	});

	it("should use explicit referenceId for organization when provided", async () => {
		const subscriptionOptions = {
			enabled: true,
			authorizeReference: vi.fn().mockResolvedValue(true),
		} as SubscriptionOptions;

		const middleware = referenceMiddleware(
			subscriptionOptions,
			"upgrade-subscription",
		);
		const mockCtx = {
			context: {
				session: {
					user: { id: "user_123" },
					session: { id: "session_123", activeOrganizationId: "org_456" },
				} as ChargebeeCtxSession,
				logger: mockLogger,
			},
			body: { customerType: "organization", referenceId: "org_789" },
			query: {},
		} as never;

		await expect(middleware(mockCtx)).resolves.toBeUndefined();
		expect(subscriptionOptions.authorizeReference).toHaveBeenCalledWith(
			expect.objectContaining({
				user: mockCtx.context.session.user,
				session: mockCtx.context.session.session,
				referenceId: "org_789",
				action: "upgrade-subscription",
			}),
			expect.any(Object),
		);
	});

	it("should throw when organization type but no active organization", async () => {
		const subscriptionOptions = {
			enabled: true,
			authorizeReference: vi.fn().mockResolvedValue(true),
		} as SubscriptionOptions;

		const middleware = referenceMiddleware(
			subscriptionOptions,
			"upgrade-subscription",
		);
		const mockCtx = {
			context: {
				session: {
					user: { id: "user_123" },
					session: { id: "session_123" },
				} as ChargebeeCtxSession,
				logger: mockLogger,
			},
			body: { customerType: "organization" },
			query: {},
		} as never;

		await expect(middleware(mockCtx)).rejects.toThrow(APIError);
		await expect(middleware(mockCtx)).rejects.toMatchObject({
			message: CHARGEBEE_ERROR_CODES.ORGANIZATION_NOT_FOUND,
		});
	});

	it("should read customerType from query params", async () => {
		const subscriptionOptions = {
			enabled: true,
			authorizeReference: vi.fn().mockResolvedValue(true),
		} as SubscriptionOptions;

		const middleware = referenceMiddleware(
			subscriptionOptions,
			"cancel-subscription",
		);
		const mockCtx = {
			context: {
				session: {
					user: { id: "user_123" },
					session: { id: "session_123", activeOrganizationId: "org_456" },
				} as ChargebeeCtxSession,
				logger: mockLogger,
			},
			body: {},
			query: { customerType: "organization" },
		} as never;

		await expect(middleware(mockCtx)).resolves.toBeUndefined();
		expect(subscriptionOptions.authorizeReference).toHaveBeenCalledWith(
			expect.objectContaining({
				referenceId: "org_456",
				action: "cancel-subscription",
			}),
			expect.any(Object),
		);
	});
});
