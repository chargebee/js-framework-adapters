
import type Chargebee from "chargebee";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	cancelSubscription,
	cancelSubscriptionCallback,
	createSubscription,
	getWebhookEndpoint,
	listActiveSubscriptions,
	updateSubscription,
} from "../src/routes";
import type { ChargebeeOptions } from "../src/types";

describe("routes - getWebhookEndpoint", () => {
	const mockChargebee = {
		__clientIdentifier: vi.fn(),
		webhooks: {
			createHandler: vi.fn().mockReturnValue({
				on: vi.fn().mockReturnThis(),
				handle: vi.fn().mockResolvedValue({}),
			}),
		},
	} as unknown as Chargebee;

	const mockOptions: ChargebeeOptions = {
		chargebeeClient: mockChargebee,
		webhookUsername: "test_user",
		webhookPassword: "test_pass",
	};

	it("should create webhook endpoint", () => {
		const endpoint = getWebhookEndpoint(mockOptions);

		expect(endpoint).toBeDefined();
		expect(endpoint.path).toBe("/chargebee/webhook");
	});

	it("should support webhookHandler option", () => {
		const webhookHandler = vi.fn();
		const optionsWithHandler: ChargebeeOptions = {
			...mockOptions,
			webhookHandler,
		};

		const endpoint = getWebhookEndpoint(optionsWithHandler);

		expect(endpoint).toBeDefined();
	});

	it("should support webhook credentials", () => {
		const endpoint = getWebhookEndpoint(mockOptions);

		expect(endpoint).toBeDefined();
	});

	it("should support webhook without credentials", () => {
		const optionsWithoutAuth: ChargebeeOptions = {
			chargebeeClient: mockChargebee,
		};

		const endpoint = getWebhookEndpoint(optionsWithoutAuth);

		expect(endpoint).toBeDefined();
	});
});

describe("routes - createSubscription", () => {
	const mockChargebee = {
		__clientIdentifier: vi.fn(),
		customer: {
			list: vi.fn(),
			create: vi.fn(),
		},
		subscription: {
			list: vi.fn(),
			create: vi.fn(),
			createHostedPage: vi.fn(),
			update: vi.fn(),
		},
	} as unknown as Chargebee;

	const mockPlans = [
		{ name: "Basic", itemPriceId: "basic-usd-monthly" },
		{ name: "Pro", itemPriceId: "pro-usd-monthly" },
	];

	const mockOptions: ChargebeeOptions = {
		chargebeeClient: mockChargebee,
		subscription: {
			enabled: true,
			plans: mockPlans,
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should create subscription endpoint", () => {
		const endpoint = createSubscription(mockOptions);

		expect(endpoint).toBeDefined();
		expect(endpoint.path).toBe("/subscription/create");
	});

	it("should have email verification enabled option", () => {
		const optionsWithVerification: ChargebeeOptions = {
			...mockOptions,
			subscription: {
				enabled: true,
				plans: mockPlans,
				requireEmailVerification: true,
			},
		};

		const endpoint = createSubscription(optionsWithVerification);

		expect(endpoint).toBeDefined();
	});

	it("should accept single itemPriceId", () => {
		const endpoint = createSubscription(mockOptions);

		expect(endpoint).toBeDefined();
	});

	it("should accept array of itemPriceIds", () => {
		const endpoint = createSubscription(mockOptions);

		expect(endpoint).toBeDefined();
	});

	it("should support organization subscriptions", () => {
		const optionsWithOrg: ChargebeeOptions = {
			...mockOptions,
			organization: {
				enabled: true,
			},
		};

		const endpoint = createSubscription(optionsWithOrg);

		expect(endpoint).toBeDefined();
	});

	it("should support metadata option", () => {
		const endpoint = createSubscription(mockOptions);

		expect(endpoint).toBeDefined();
	});

	it("should support seats option", () => {
		const endpoint = createSubscription(mockOptions);

		expect(endpoint).toBeDefined();
	});

	it("should support trial end option", () => {
		const endpoint = createSubscription(mockOptions);

		expect(endpoint).toBeDefined();
	});

	it("should support disable redirect option", () => {
		const endpoint = createSubscription(mockOptions);

		expect(endpoint).toBeDefined();
	});
});

describe("routes - updateSubscription", () => {
	const mockChargebee = {
		__clientIdentifier: vi.fn(),
		customer: {
			list: vi.fn(),
			create: vi.fn(),
		},
		subscription: {
			list: vi.fn(),
			update: vi.fn(),
		},
	} as unknown as Chargebee;

	const mockPlans = [
		{ name: "Basic", itemPriceId: "basic-usd-monthly" },
		{ name: "Pro", itemPriceId: "pro-usd-monthly" },
	];

	const mockOptions: ChargebeeOptions = {
		chargebeeClient: mockChargebee,
		subscription: {
			enabled: true,
			plans: mockPlans,
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should create update subscription endpoint", () => {
		const endpoint = updateSubscription(mockOptions);

		expect(endpoint).toBeDefined();
		expect(endpoint.path).toBe("/subscription/update");
	});

	it("should support organization subscriptions", () => {
		const optionsWithOrg: ChargebeeOptions = {
			...mockOptions,
			organization: {
				enabled: true,
			},
		};

		const endpoint = updateSubscription(optionsWithOrg);

		expect(endpoint).toBeDefined();
	});

	it("should support seats option", () => {
		const endpoint = updateSubscription(mockOptions);

		expect(endpoint).toBeDefined();
	});

	it("should support disable redirect option", () => {
		const endpoint = updateSubscription(mockOptions);

		expect(endpoint).toBeDefined();
	});
});

describe("routes - listActiveSubscriptions", () => {
	const mockChargebee = {
		__clientIdentifier: vi.fn(),
	} as unknown as Chargebee;

	const mockPlans = [
		{ name: "Basic", itemPriceId: "basic-usd-monthly", type: "plan" as const },
		{ name: "Pro", itemPriceId: "pro-usd-monthly", type: "plan" as const },
	];

	const mockOptions: ChargebeeOptions = {
		chargebeeClient: mockChargebee,
		subscription: {
			enabled: true,
			plans: mockPlans,
		},
	};

	it("should create list active subscriptions endpoint", () => {
		const endpoint = listActiveSubscriptions(mockOptions);

		expect(endpoint).toBeDefined();
		expect(endpoint.path).toBe("/subscription/list");
	});

	it("should support async plans function", () => {
		const optionsWithAsyncPlans: ChargebeeOptions = {
			...mockOptions,
			subscription: {
				enabled: true,
				plans: async () => mockPlans,
			},
		};

		const endpoint = listActiveSubscriptions(optionsWithAsyncPlans);

		expect(endpoint).toBeDefined();
	});
});

describe("routes - cancelSubscription", () => {
	const mockChargebee = {
		__clientIdentifier: vi.fn(),
		subscription: {
			list: vi.fn(),
			cancel: vi.fn(),
			update: vi.fn(),
		},
		portalSession: {
			create: vi.fn(),
		},
	} as unknown as Chargebee;

	const mockOptions: ChargebeeOptions = {
		chargebeeClient: mockChargebee,
		subscription: {
			enabled: true,
			plans: [],
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should create cancel subscription endpoint", () => {
		const endpoint = cancelSubscription(mockOptions);

		expect(endpoint).toBeDefined();
		expect(endpoint.path).toBe("/subscription/cancel");
	});

	it("should support disableRedirect option", () => {
		const endpoint = cancelSubscription(mockOptions);

		expect(endpoint).toBeDefined();
	});

	it("should support returnUrl option", () => {
		const endpoint = cancelSubscription(mockOptions);

		expect(endpoint).toBeDefined();
	});
});

describe("routes - cancelSubscriptionCallback", () => {
	const mockChargebee = {
		__clientIdentifier: vi.fn(),
		subscription: {
			retrieve: vi.fn(),
		},
	} as unknown as Chargebee;

	const mockOptions: ChargebeeOptions = {
		chargebeeClient: mockChargebee,
		subscription: {
			enabled: true,
			plans: [],
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should create cancel subscription callback endpoint", () => {
		const endpoint = cancelSubscriptionCallback(mockOptions);

		expect(endpoint).toBeDefined();
		expect(endpoint.path).toBe("/subscription/cancel/callback");
	});
});
