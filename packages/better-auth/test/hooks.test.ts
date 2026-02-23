import type { User } from "better-auth";
import type Chargebee from "chargebee";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chargebee } from "../src";
import type { WithChargebeeCustomerId } from "../src/types";

describe("database hooks", () => {
	const mockLogger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};

	const mockAdapter = {
		findMany: vi.fn(),
		findOne: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		updateUser: vi.fn(),
		deleteMany: vi.fn(),
	};

	const mockChargebeeClient = {
		__clientIdentifier: vi.fn(),
		customer: {
			list: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
		},
		subscription: {
			cancel: vi.fn(),
		},
	} as unknown as Chargebee;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("user.create.after hook", () => {
		it("should skip customer creation when createCustomerOnSignUp is false", async () => {
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
				createCustomerOnSignUp: false,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.user?.create?.after;

			const user: User = {
				id: "user_123",
				email: "test@example.com",
				name: "Test User",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			await hook?.(user);

			expect(mockChargebeeClient.customer.list).not.toHaveBeenCalled();
		});

		it("should use existing customer if found", async () => {
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
				createCustomerOnSignUp: true,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			const existingCustomer = {
				id: "cust_existing",
				email: "test@example.com",
			};

			mockChargebeeClient.customer.list = vi.fn().mockResolvedValue({
				list: [{ customer: existingCustomer }],
			});

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.user?.create?.after;

			const user: User = {
				id: "user_123",
				email: "test@example.com",
				name: "Test User",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			await hook?.(user);

			expect(mockChargebeeClient.customer.list).toHaveBeenCalledWith({
				email: { is: "test@example.com" },
				limit: 1,
			});
			expect(mockAdapter.updateUser).toHaveBeenCalledWith("user_123", {
				chargebeeCustomerId: "cust_existing",
			});
		});

		it("should create new customer if not found", async () => {
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
				createCustomerOnSignUp: true,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			const newCustomer = {
				id: "cust_new",
				email: "test@example.com",
			};

			mockChargebeeClient.customer.list = vi.fn().mockResolvedValue({
				list: [],
			});
			mockChargebeeClient.customer.create = vi.fn().mockResolvedValue({
				customer: newCustomer,
			});

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.user?.create?.after;

			const user: User = {
				id: "user_123",
				email: "test@example.com",
				name: "John Doe",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			await hook?.(user);

			expect(mockChargebeeClient.customer.create).toHaveBeenCalledWith(
				expect.objectContaining({
					email: "test@example.com",
					first_name: "John",
					last_name: "Doe",
				}),
			);
			expect(mockAdapter.updateUser).toHaveBeenCalledWith("user_123", {
				chargebeeCustomerId: "cust_new",
			});
		});

		it("should handle single name without space", async () => {
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
				createCustomerOnSignUp: true,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			mockChargebeeClient.customer.list = vi.fn().mockResolvedValue({
				list: [],
			});
			mockChargebeeClient.customer.create = vi.fn().mockResolvedValue({
				customer: { id: "cust_new" },
			});

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.user?.create?.after;

			const user: User = {
				id: "user_123",
				email: "test@example.com",
				name: "John",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			await hook?.(user);

			expect(mockChargebeeClient.customer.create).toHaveBeenCalledWith(
				expect.objectContaining({
					first_name: "John",
					last_name: "",
				}),
			);
		});

		it("should call onCustomerCreate callback if provided", async () => {
			const onCustomerCreate = vi.fn();
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
				createCustomerOnSignUp: true,
				onCustomerCreate,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			const newCustomer = {
				id: "cust_new",
				email: "test@example.com",
			};

			mockChargebeeClient.customer.list = vi.fn().mockResolvedValue({
				list: [],
			});
			mockChargebeeClient.customer.create = vi.fn().mockResolvedValue({
				customer: newCustomer,
			});

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.user?.create?.after;

			const user: User = {
				id: "user_123",
				email: "test@example.com",
				name: "Test User",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			await hook?.(user);

			expect(onCustomerCreate).toHaveBeenCalledWith({
				chargebeeCustomer: newCustomer,
				user,
			});
		});

		it("should handle errors gracefully and log them", async () => {
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
				createCustomerOnSignUp: true,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			mockChargebeeClient.customer.list = vi
				.fn()
				.mockRejectedValue(new Error("Chargebee API error"));

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.user?.create?.after;

			const user: User = {
				id: "user_123",
				email: "test@example.com",
				name: "Test User",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			await expect(hook?.(user)).resolves.toBeUndefined();
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining("Error creating Chargebee customer"),
				expect.any(Error),
			);
		});
	});

	describe("user.update.after hook", () => {
		it("should skip update when no chargebeeCustomerId", async () => {
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.user?.update?.after;

			const user: User & WithChargebeeCustomerId = {
				id: "user_123",
				email: "test@example.com",
				name: "Test User",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
				chargebeeCustomerId: null,
			};

			await hook?.(user);

			expect(mockChargebeeClient.customer.update).not.toHaveBeenCalled();
		});

		it("should update customer email in Chargebee", async () => {
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			mockChargebeeClient.customer.update = vi.fn().mockResolvedValue({});

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.user?.update?.after;

			const user: User & WithChargebeeCustomerId = {
				id: "user_123",
				email: "newemail@example.com",
				name: "Test User",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
				chargebeeCustomerId: "cust_123",
			};

			await hook?.(user);

			expect(mockChargebeeClient.customer.update).toHaveBeenCalledWith(
				"cust_123",
				{
					email: "newemail@example.com",
				},
			);
		});

		it("should silently fail if update throws error", async () => {
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			mockChargebeeClient.customer.update = vi
				.fn()
				.mockRejectedValue(new Error("Update failed"));

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.user?.update?.after;

			const user: User & WithChargebeeCustomerId = {
				id: "user_123",
				email: "newemail@example.com",
				name: "Test User",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
				chargebeeCustomerId: "cust_123",
			};

			await expect(hook?.(user)).resolves.toBeUndefined();
		});
	});

	describe("delete.before hook", () => {
		it("should cancel and delete subscriptions before deleting user", async () => {
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			const subscriptions = [
				{
					id: "sub_local_123",
					chargebeeSubscriptionId: "sub_cb_123",
				},
			];

			mockAdapter.findMany = vi.fn().mockResolvedValue(subscriptions);
			mockAdapter.deleteMany = vi.fn().mockResolvedValue(undefined);
			mockChargebeeClient.subscription.cancel = vi
				.fn()
				.mockResolvedValue({ subscription: { id: "sub_cb_123" } });

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.delete?.before;

			const user: User & WithChargebeeCustomerId = {
				id: "user_123",
				email: "test@example.com",
				name: "Test User",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
				chargebeeCustomerId: "cust_123",
			};

			await hook?.(user);

			expect(mockAdapter.findMany).toHaveBeenCalledWith({
				model: "subscription",
				where: [
					{
						field: "referenceId",
						value: "user_123",
					},
				],
			});

			expect(mockChargebeeClient.subscription.cancel).toHaveBeenCalledWith(
				"sub_cb_123",
				{
					end_of_term: false,
				},
			);

			expect(mockAdapter.deleteMany).toHaveBeenCalledWith({
				model: "subscriptionItem",
				where: [
					{
						field: "subscriptionId",
						value: "sub_local_123",
					},
				],
			});

			expect(mockAdapter.deleteMany).toHaveBeenCalledWith({
				model: "subscription",
				where: [
					{
						field: "id",
						value: "sub_local_123",
					},
				],
			});

			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining("Cleaned up 1 subscription"),
			);
		});

		it("should continue even if Chargebee cancellation fails", async () => {
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			const subscriptions = [
				{
					id: "sub_local_123",
					chargebeeSubscriptionId: "sub_cb_123",
				},
			];

			mockAdapter.findMany = vi.fn().mockResolvedValue(subscriptions);
			mockAdapter.deleteMany = vi.fn().mockResolvedValue(undefined);
			mockChargebeeClient.subscription.cancel = vi
				.fn()
				.mockRejectedValue(new Error("Already cancelled"));

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.delete?.before;

			const user: User & WithChargebeeCustomerId = {
				id: "user_123",
				email: "test@example.com",
				name: "Test User",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
				chargebeeCustomerId: "cust_123",
			};

			await hook?.(user);

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining("Failed to cancel subscription in Chargebee"),
			);

			expect(mockAdapter.deleteMany).toHaveBeenCalledTimes(2);
		});

		it("should handle subscriptions without chargebeeSubscriptionId", async () => {
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			const subscriptions = [
				{
					id: "sub_local_123",
					chargebeeSubscriptionId: null,
				},
			];

			mockAdapter.findMany = vi.fn().mockResolvedValue(subscriptions);
			mockAdapter.deleteMany = vi.fn().mockResolvedValue(undefined);

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.delete?.before;

			const user: User & WithChargebeeCustomerId = {
				id: "user_123",
				email: "test@example.com",
				name: "Test User",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
				chargebeeCustomerId: "cust_123",
			};

			await hook?.(user);

			expect(mockChargebeeClient.subscription.cancel).not.toHaveBeenCalled();
			expect(mockAdapter.deleteMany).toHaveBeenCalledTimes(2);
		});

		it("should log error but not throw on cleanup failure", async () => {
			const plugin = chargebee({
				chargebeeClient: mockChargebeeClient,
			});

			const ctx = {
				internalAdapter: mockAdapter,
				adapter: mockAdapter,
				logger: mockLogger,
			};

			mockAdapter.findMany = vi
				.fn()
				.mockRejectedValue(new Error("Database error"));

			const initResult = plugin.init(ctx as never);
			const hook = initResult.options.databaseHooks?.delete?.before;

			const user: User & WithChargebeeCustomerId = {
				id: "user_123",
				email: "test@example.com",
				name: "Test User",
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
				chargebeeCustomerId: "cust_123",
			};

			await expect(hook?.(user)).resolves.toBeUndefined();
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining("Error cleaning up subscriptions"),
				expect.any(Error),
			);
		});
	});
});
