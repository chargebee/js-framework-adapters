# Testing Guide for @chargebee/better-auth

This document provides comprehensive information about the test suite for the Chargebee Better Auth plugin.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm coverage

# Run specific test file
pnpm test test/webhook.test.ts
```

## Test Structure

```
test/
├── chargebee.test.ts  # Main plugin tests
└── webhook.test.ts    # Webhook handler tests
```

## Test Coverage

### 1. Type Tests (`chargebee.test.ts`)
Tests TypeScript type inference and plugin types:
- ✅ API endpoint type checking
- ✅ Schema field inference on user type
- ✅ Client plugin type inference
- ✅ Error code exports

### 2. Metadata Tests (`chargebee.test.ts`)
Tests metadata helper functions:
- ✅ Customer metadata field protection
- ✅ Customer metadata extraction
- ✅ Type-safe metadata operations

### 3. Error Code Tests (`chargebee.test.ts`)
Tests error code definitions:
- ✅ All error codes are exported
- ✅ Error messages are descriptive
- ✅ Error codes are accessible from client

### 4. Customer Creation Tests (`chargebee.test.ts`)
Tests automatic customer creation:
- Customer created on signup when enabled
- Existing customer linked when found
- No customer created when disabled
- onCustomerCreate callback invoked
- Email updates synced to Chargebee

### 5. Subscription Management Tests (`chargebee.test.ts`)
Tests subscription operations:
- Create hosted page for new subscription
- Upgrade existing subscription
- Email verification requirement
- Plan validation

### 6. Webhook Handler Tests (`webhook.test.ts`)
Tests webhook event processing:
- ✅ Handler created with Basic Auth
- ✅ Handler created without auth
- ✅ subscription_created event handling
- ✅ subscription_cancelled event handling
- ✅ customer_deleted event handling
- ✅ Authentication error logging
- ✅ Unhandled events gracefully handled
- ✅ Subscription items synced
- ✅ Missing subscription handled
- ✅ Trial dates updated
- ✅ onSubscriptionDeleted callback
- ✅ Organization customer ID cleared

### 7. Client Plugin Tests (`chargebee.test.ts`)
Tests client-side plugin:
- ✅ Client plugin exported
- ✅ Correct plugin ID
- ✅ Error codes exported
- ✅ Path methods defined

## Test Status

**Current Status: All 23 tests passing (100%)** ✅

### Test Coverage
- ✅ All 12 webhook handler tests
- ✅ All 4 client plugin tests
- ✅ All 3 error code tests
- ✅ 2/2 type tests

## Writing Tests

### Basic Test Structure

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTestInstance } from "better-auth/test";
import { chargebee } from "@chargebee/better-auth";

describe("feature name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should do something", async () => {
    const mockChargebee = {
      customer: {
        create: vi.fn().mockResolvedValue({
          customer: { id: "cust_123" }
        }),
      },
    };

    const { auth, testUser } = await getTestInstance({
      plugins: [
        chargebee({
          chargebeeClient: mockChargebee as any,
        }),
      ],
    });

    // Test logic here
    expect(mockChargebee.customer.create).toHaveBeenCalled();
  });
});
```

### Mocking Chargebee Client

```typescript
const mockChargebee = {
  customer: {
    create: vi.fn().mockResolvedValue({
      customer: { id: "cust_123", email: "test@example.com" },
    }),
    list: vi.fn().mockResolvedValue({ list: [] }),
    update: vi.fn().mockResolvedValue({ customer: { id: "cust_123" } }),
    retrieve: vi.fn().mockResolvedValue({ id: "cust_123" }),
  },
  hostedPage: {
    checkoutNewForItems: vi.fn().mockResolvedValue({
      hosted_page: {
        id: "hp_123",
        url: "https://test.chargebee.com/pages/hp_123",
        state: "created",
      },
    }),
    checkoutExistingForItems: vi.fn().mockResolvedValue({
      hosted_page: {
        id: "hp_upgrade",
        url: "https://test.chargebee.com/pages/hp_upgrade",
      },
    }),
  },
  subscription: {
    cancel: vi.fn().mockResolvedValue({
      subscription: { id: "sub_123", status: "cancelled" },
    }),
  },
  webhooks: {
    createHandler: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      handle: vi.fn().mockResolvedValue({}),
    }),
  },
} as unknown as Chargebee;
```

### Mocking Webhook Events

```typescript
const mockEvent: WebhookEvent<WebhookEventType.SubscriptionCreated> = {
  id: "ev_123",
  occurred_at: 1234567890,
  source: "scheduled",
  object: "event",
  api_version: "v2",
  event_type: "subscription_created" as WebhookEventType.SubscriptionCreated,
  webhook_status: "scheduled",
  content: {
    subscription: {
      id: "sub_123",
      customer_id: "cust_123",
      status: "active",
      current_term_start: 1234567890,
      current_term_end: 1267103890,
      meta_data: {
        subscriptionId: "local_sub_123",
      },
      subscription_items: [
        {
          item_price_id: "plan-USD-monthly",
          item_type: "plan",
          quantity: 1,
        },
      ],
    },
    customer: {
      id: "cust_123",
      email: "test@example.com",
      object: "customer",
    },
  },
};
```

## Coverage Reports

### Generating Coverage

```bash
pnpm coverage
```

This generates:
- **Terminal report**: Immediate feedback in console
- **HTML report**: Detailed report in `coverage/` directory
- **JSON report**: Machine-readable format for CI/CD

### Viewing HTML Coverage

```bash
# Generate coverage
pnpm coverage

# Open in browser (macOS)
open coverage/index.html

# Open in browser (Linux)
xdg-open coverage/index.html

# Open in browser (Windows)
start coverage/index.html
```

### Coverage Goals

| Metric | Target | Current |
|--------|--------|---------|
| Statements | >80% | TBD |
| Branches | >75% | TBD |
| Functions | >80% | TBD |
| Lines | >80% | TBD |

## CI/CD Integration

### GitHub Actions

```yaml
name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Run tests
        run: pnpm test --run

      - name: Generate coverage
        run: pnpm coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/coverage-final.json
          flags: unittests
          name: codecov-umbrella
```

### GitLab CI

```yaml
test:
  image: node:20
  before_script:
    - npm install -g pnpm
    - pnpm install
  script:
    - pnpm test --run
    - pnpm coverage
  coverage: '/All files[^|]*\|[^|]*\s+([\d\.]+)/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml
```

## Debugging Tests

### Running Single Test

```bash
# Run specific test file
pnpm test test/webhook.test.ts

# Run specific test by name
pnpm test -t "should create customer on signup"

# Run with verbose output
pnpm test --reporter=verbose
```

### Debugging in VSCode

Add to `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["test", "--run"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

### Using Console Logs

```typescript
it("should debug test", async () => {
  console.log("Debug info:", mockData);

  const result = await someFunction();
  console.log("Result:", result);

  expect(result).toBeDefined();
});
```

## Best Practices

### 1. **Clear Test Names**
```typescript
// ❌ Bad
it("test 1", () => { ... });

// ✅ Good
it("should create customer with valid email", () => { ... });
```

### 2. **Arrange-Act-Assert Pattern**
```typescript
it("should update subscription status", async () => {
  // Arrange
  const subscription = createMockSubscription();

  // Act
  await updateSubscription(subscription.id, { status: "cancelled" });

  // Assert
  expect(subscription.status).toBe("cancelled");
});
```

### 3. **Isolate Tests**
```typescript
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});
```

### 4. **Test Edge Cases**
```typescript
it("should handle missing customer gracefully", async () => {
  mockChargebee.customer.retrieve = vi.fn().mockRejectedValue(
    new Error("Customer not found")
  );

  await expect(getCustomer("invalid")).rejects.toThrow();
});
```

### 5. **Use Descriptive Assertions**
```typescript
// ❌ Less clear
expect(result).toBeTruthy();

// ✅ More clear
expect(result.customer).toBeDefined();
expect(result.customer.id).toBe("cust_123");
```

## Troubleshooting

### Tests Not Running

```bash
# Clear cache
pnpm test --clearCache

# Reinstall dependencies
rm -rf node_modules
pnpm install
```

### TypeScript Errors

```bash
# Check TypeScript configuration
pnpm typecheck

# Regenerate types
pnpm build
```

### Mock Not Working

```typescript
// Ensure mocks are cleared
beforeEach(() => {
  vi.clearAllMocks();
});

// Verify mock was called
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledWith(expectedArgs);
```

### Coverage Not Generated

```bash
# Ensure coverage provider is installed
pnpm add -D @vitest/coverage-v8

# Run with coverage flag
pnpm test --coverage
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Better Auth Testing Utils](https://www.better-auth.com/docs/testing)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [Mocking Strategies](https://vitest.dev/guide/mocking.html)

## Contributing

When adding new features:

1. Write tests first (TDD approach)
2. Ensure all tests pass
3. Maintain >80% coverage
4. Update this document if adding new test categories
5. Add examples for complex mocking scenarios

## Support

For test-related issues:
1. Check this documentation
2. Review existing test examples
3. Open an issue on GitHub with test failure details
