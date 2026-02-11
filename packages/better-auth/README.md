# @chargebee/better-auth

A Better Auth plugin for seamless Chargebee billing integration with automatic customer and subscription management.

## Features

- 🔐 **Automatic Customer Creation** - Create Chargebee customers on user signup
- 💳 **Subscription Management** - Create, upgrade, and cancel subscriptions
- 🔄 **Webhook Handling** - Automatic sync of subscription events from Chargebee
- 🏢 **Organization Support** - Multi-tenant subscription management
- 🎯 **Type-Safe** - Full TypeScript support with type inference
- 🛡️ **Secure** - Basic Auth webhook validation
- 🎨 **Hosted Pages** - Use Chargebee's hosted checkout pages

## Installation

```bash
npm install @chargebee/better-auth chargebee
# or
pnpm add @chargebee/better-auth chargebee
# or
yarn add @chargebee/better-auth chargebee
```

## Quick Start

### 1. Server Configuration

```typescript
// lib/auth.ts
import { betterAuth } from "better-auth";
import { chargebee } from "@chargebee/better-auth";
import Chargebee from "chargebee";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";

// Initialize Chargebee client
const chargebeeClient = new Chargebee({
  site: process.env.CHARGEBEE_SITE!,
  apiKey: process.env.CHARGEBEE_API_KEY!,
});

// Fetch plans from Chargebee
const plans = await chargebeeClient.itemPrice.list({
  item_type: { is: "plan" },
});

const confPlans = plans.list.map((plan) => ({
  name: plan.item_price.name,
  itemPriceId: plan.item_price.id,
  type: "plan" as const,
}));

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  emailAndPassword: {
    enabled: true,
  },
  secret: process.env.BETTER_AUTH_SECRET!,
  plugins: [
    chargebee({
      chargebeeClient,
      createCustomerOnSignUp: true,
      webhookUsername: process.env.CHARGEBEE_WEBHOOK_USERNAME,
      webhookPassword: process.env.CHARGEBEE_WEBHOOK_PASSWORD,
      subscription: {
        enabled: true,
        plans: confPlans,
      },
    }),
  ],
});
```

### 2. Client Configuration

```typescript
// lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import { chargebeeClient } from "@chargebee/better-auth/client";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  plugins: [
    chargebeeClient({
      subscription: true,
    }),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
```

### 3. API Route Setup (Next.js)

```typescript
// app/api/auth/[...all]/route.ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

### 4. Environment Variables

```env
# Better Auth
BETTER_AUTH_SECRET=your-secret-key-here
BETTER_AUTH_URL=http://localhost:3000

# Chargebee
CHARGEBEE_SITE=your-site-name
CHARGEBEE_API_KEY=your-api-key

# Webhook Authentication
CHARGEBEE_WEBHOOK_USERNAME=your-webhook-username
CHARGEBEE_WEBHOOK_PASSWORD=your-webhook-password
```

## Database Schema

Add the Chargebee fields to your schema:

```prisma
model User {
  id                  String    @id
  email               String    @unique
  name                String?
  chargebeeCustomerId String?   @unique
  // ... other fields
}

model Subscription {
  id                       String    @id
  referenceId              String    // userId or organizationId
  chargebeeCustomerId      String?
  chargebeeSubscriptionId  String?   @unique
  status                   String?
  periodStart              DateTime?
  periodEnd                DateTime?
  trialStart               DateTime?
  trialEnd                 DateTime?
  canceledAt               DateTime?
  cancelAt                 DateTime?
  cancelAtPeriodEnd        Boolean?
  endedAt                  DateTime?
  metadata                 String?
  createdAt                DateTime  @default(now())
  updatedAt                DateTime  @updatedAt
  subscriptionItems        SubscriptionItem[]
}

model SubscriptionItem {
  id             String       @id
  subscriptionId String
  itemPriceId    String
  itemType       String       // "plan" | "addon" | "charge"
  quantity       Int          @default(1)
  unitPrice      Int?
  amount         Int?
  subscription   Subscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
}
```

## Usage Examples

### Create/Upgrade Subscription

```typescript
// Server-side API route
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function POST(request: NextRequest) {
  const body = await request.json();

  const result = await auth.api.upgradeSubscription({
    body: {
      itemPriceId: body.itemPriceId,
      successUrl: `${baseUrl}/dashboard?success=true`,
      cancelUrl: `${baseUrl}/pricing?canceled=true`,
      trialEnd: body.trialEnd, // Optional: Unix timestamp
    },
    headers: await headers(),
  });

  // Redirect user to Chargebee hosted page
  return NextResponse.json(result);
}
```

### Cancel Subscription

```typescript
// Client-side
const handleCancelSubscription = async () => {
  const response = await fetch("/api/subscription/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscriptionId: subscription.chargebeeSubscriptionId,
      returnUrl: window.location.origin + "/subscription",
    }),
  });

  const data = await response.json();

  // Redirect to Chargebee cancellation portal
  if (data.url) {
    window.location.href = data.url;
  }
};
```

### Get Subscription Status

```typescript
// Server-side API route
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch subscription from database
  const subscription = await prisma.subscription.findFirst({
    where: { referenceId: session.user.id },
    include: { subscriptionItems: true },
  });

  return NextResponse.json({ subscription });
}
```

### Display Pricing Plans

```typescript
"use client";

import { useState, useEffect } from "react";
import { authClient } from "@/lib/auth-client";

export default function PricingPage() {
  const [plans, setPlans] = useState([]);
  const { data: session } = authClient.useSession();

  const handleUpgrade = async (plan) => {
    if (!session?.user) {
      router.push("/login");
      return;
    }

    const response = await fetch("/api/subscription/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemPriceId: plan.id,
        successUrl: `${window.location.origin}/dashboard?success=true`,
        cancelUrl: `${window.location.origin}/pricing?canceled=true`,
      }),
    });

    const data = await response.json();

    if (data.url) {
      window.location.href = data.url; // Redirect to Chargebee
    }
  };

  return (
    <div>
      {plans.map((plan) => (
        <div key={plan.id}>
          <h3>{plan.name}</h3>
          <button onClick={() => handleUpgrade(plan)}>
            Subscribe
          </button>
        </div>
      ))}
    </div>
  );
}
```

## Webhook Setup

### 1. Configure Webhook Endpoint

You can configure the webhook endpoint either through the Chargebee dashboard or programmatically via API.

#### Option A: Via Chargebee Dashboard

1. Go to **Settings → Webhooks** in your Chargebee dashboard
2. Add webhook endpoint: `https://your-domain.com/api/auth/chargebee/webhook`
3. Enable **Basic Authentication**:
   - Username: Your `CHARGEBEE_WEBHOOK_USERNAME`
   - Password: Your `CHARGEBEE_WEBHOOK_PASSWORD`
4. Select events to listen to:
   - `subscription_created`
   - `subscription_activated`
   - `subscription_changed`
   - `subscription_renewed`
   - `subscription_cancelled`
   - `customer_deleted`

#### Option B: Programmatically via API

```typescript
import Chargebee from "chargebee";

const chargebeeClient = new Chargebee({
  site: process.env.CHARGEBEE_SITE!,
  apiKey: process.env.CHARGEBEE_API_KEY!,
});

// Create webhook endpoint
const result = await chargebeeClient.webhookEndpoint.create({
  name: "Better Auth Webhook",
  api_version: "v2",
  url: "https://your-domain.com/api/auth/chargebee/webhook",
  primary_url: true,
  disabled: false,
  basic_auth_username: process.env.CHARGEBEE_WEBHOOK_USERNAME,
  basic_auth_password: process.env.CHARGEBEE_WEBHOOK_PASSWORD,
  enabled_events: [
    "subscription_created",
    "subscription_activated",
    "subscription_changed",
    "subscription_renewed",
    "subscription_started",
    "subscription_cancelled",
    "subscription_cancellation_scheduled",
    "customer_deleted",
  ],
});

console.log("Webhook created:", result.webhook_endpoint.id);
```

### 2. Webhook Events Handled

The plugin automatically handles these events:

- **subscription_created** - Creates/updates subscription in database
- **subscription_activated** - Activates subscription
- **subscription_changed** - Updates subscription details
- **subscription_renewed** - Updates renewal information
- **subscription_cancelled** - Marks subscription as cancelled
- **customer_deleted** - Cleans up customer data

### 3. Local Testing

For local development, use ngrok or a similar tunneling service to expose your local server:

```bash
# Install ngrok
npm install -g ngrok

# Start your local development server
npm run dev  # Running on http://localhost:3000

# In another terminal, create a tunnel
ngrok http 3000

# You'll get a public URL like: https://abc123.ngrok.io
```

Then create a webhook endpoint pointing to your ngrok URL:

```typescript
// Create webhook for local testing
const result = await chargebeeClient.webhookEndpoint.create({
  name: "Local Development Webhook",
  api_version: "v2",
  url: "https://abc123.ngrok.io/api/auth/chargebee/webhook",
  primary_url: false,  // Don't make this primary
  disabled: false,
  basic_auth_username: "test",
  basic_auth_password: "test123",
  enabled_events: [
    "subscription_created",
    "subscription_activated",
    "subscription_changed",
    "subscription_cancelled",
  ],
});
```

**Remember to:**
- Update your `.env.local` with the test credentials
- Delete the test webhook when done
- Use a non-primary webhook for testing

### 4. Managing Webhooks Programmatically

```typescript
// List all webhook endpoints
const webhooks = await chargebeeClient.webhookEndpoint.list({ limit: 100 });
console.log("Existing webhooks:", webhooks.list);

// Retrieve a specific webhook
const webhook = await chargebeeClient.webhookEndpoint.retrieve("webhook_id");
console.log("Webhook details:", webhook.webhook_endpoint);

// Update a webhook endpoint
await chargebeeClient.webhookEndpoint.update("webhook_id", {
  disabled: true,  // Disable temporarily
  name: "Updated Webhook Name",
});

// Delete a webhook endpoint
await chargebeeClient.webhookEndpoint.delete("webhook_id");
```

## API Endpoints

### Available Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/chargebee/webhook` | POST | Webhook handler for Chargebee events |
| `/api/auth/subscription/upgrade` | POST | Create or upgrade subscription |
| `/api/auth/subscription/cancel` | POST | Cancel subscription |
| `/api/auth/subscription/cancel-callback` | POST | Handle cancellation callback |

### Upgrade Subscription

**Request:**
```typescript
POST /api/auth/subscription/upgrade

{
  itemPriceId: string;
  subscriptionId?: string;  // For upgrades
  successUrl: string;
  cancelUrl: string;
  trialEnd?: number;        // Unix timestamp
  seats?: number;           // For seat-based plans
  metadata?: Record<string, any>;
}
```

**Response:**
```typescript
{
  url: string;  // Chargebee hosted page URL
  redirect: boolean;
}
```

### Cancel Subscription

**Request:**
```typescript
POST /api/auth/subscription/cancel

{
  subscriptionId: string;
  returnUrl: string;
}
```

**Response:**
```typescript
{
  url: string;  // Chargebee cancellation portal URL
  redirect: boolean;
}
```

## Plugin Options

### ChargebeeOptions

```typescript
interface ChargebeeOptions {
  // Required
  chargebeeClient: Chargebee;

  // Optional
  webhookUsername?: string;
  webhookPassword?: string;
  createCustomerOnSignUp?: boolean;

  // Callbacks
  onCustomerCreate?: (params: {
    chargebeeCustomer: Customer;
    user: any;
  }) => Promise<void> | void;

  onEvent?: (event: any) => Promise<void> | void;

  // Subscription
  subscription?: {
    enabled: boolean;
    plans: ChargebeePlan[] | (() => Promise<ChargebeePlan[]>);
    preventDuplicateTrails?: boolean;
    requireEmailVerification?: boolean;

    // Lifecycle callbacks
    onSubscriptionComplete?: (params: any) => Promise<void> | void;
    onSubscriptionCreated?: (params: any) => Promise<void> | void;
    onSubscriptionUpdate?: (params: any) => Promise<void> | void;
    onSubscriptionDeleted?: (params: any) => Promise<void> | void;

    // Hosted page customization
    getHostedPageParams?: (
      params: {
        user: any;
        session: any;
        plan: ChargebeePlan;
        subscription: Subscription;
      },
      request: Request,
      ctx: any,
    ) => Promise<Record<string, any>>;

    // Authorization
    authorizeReference?: (
      params: {
        user: any;
        session: any;
        referenceId: string;
        action: AuthorizeReferenceAction;
      },
      ctx: any,
    ) => Promise<boolean>;
  };

  // Organization
  organization?: {
    enabled: boolean;
    getCustomerCreateParams?: (
      organization: any,
      ctx: any,
    ) => Promise<Partial<any>>;
    onCustomerCreate?: (
      params: {
        chargebeeCustomer: Customer;
        organization: any;
      },
      ctx: any,
    ) => Promise<void> | void;
  };
}
```

## Error Handling

The plugin exports typed error codes:

```typescript
import { CHARGEBEE_ERROR_CODES } from "@chargebee/better-auth";

// Available error codes
CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED
CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND
CHARGEBEE_ERROR_CODES.PLAN_NOT_FOUND
CHARGEBEE_ERROR_CODES.CUSTOMER_NOT_FOUND
CHARGEBEE_ERROR_CODES.UNAUTHORIZED_REFERENCE
CHARGEBEE_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED
// ... and more
```

Handle errors in your application:

```typescript
try {
  await auth.api.upgradeSubscription({ ... });
} catch (error) {
  if (error.code === CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED) {
    // Handle duplicate subscription
  }
}
```

## TypeScript Support

Full TypeScript support with type inference:

```typescript
import type {
  ChargebeeOptions,
  ChargebeePlan,
  Subscription,
  SubscriptionStatus,
} from "@chargebee/better-auth";

// Types are automatically inferred from your configuration
const subscription: Subscription = {
  id: "sub_123",
  referenceId: "user_123",
  status: "active",
  // ... TypeScript will validate all fields
};
```

## Organization Support

Enable multi-tenant subscriptions:

```typescript
chargebee({
  chargebeeClient,
  subscription: {
    enabled: true,
    plans: confPlans,
  },
  organization: {
    enabled: true,
    getCustomerCreateParams: async (organization, ctx) => {
      return {
        name: organization.name,
        metadata: {
          organizationId: organization.id,
        },
      };
    },
    onCustomerCreate: async ({ chargebeeCustomer, organization }, ctx) => {
      console.log(`Created customer for org: ${organization.name}`);
    },
  },
});
```

## Advanced Usage

### Custom Hosted Page Parameters

```typescript
subscription: {
  enabled: true,
  plans: confPlans,
  getHostedPageParams: async ({ user, session, plan, subscription }) => {
    return {
      customer: {
        first_name: user.name?.split(" ")[0],
        last_name: user.name?.split(" ").slice(1).join(" "),
        locale: user.locale || "en",
      },
      subscription: {
        meta_data: {
          source: "web-app",
          referrer: session.referrer,
        },
      },
    };
  },
}
```

### Authorization for Organization Subscriptions

```typescript
subscription: {
  enabled: true,
  plans: confPlans,
  authorizeReference: async ({ user, session, referenceId, action }) => {
    // Check if user has permission to manage organization subscription
    const membership = await db.organizationMember.findFirst({
      where: {
        userId: user.id,
        organizationId: referenceId,
        role: { in: ["admin", "owner"] },
      },
    });

    return !!membership;
  },
}
```

### Prevent Duplicate Trials

```typescript
subscription: {
  enabled: true,
  plans: confPlans,
  preventDuplicateTrails: true, // Users can only have one trial
}
```

## Troubleshooting

### Webhook not receiving events

1. Check webhook URL is accessible from internet
2. Verify Basic Auth credentials match
3. Check Chargebee webhook logs in dashboard
4. Test locally using Chargebee CLI

### Subscription not syncing

1. Verify webhook events are enabled in Chargebee
2. Check application logs for webhook errors
3. Ensure database schema matches plugin requirements
4. Verify `chargebeeSubscriptionId` is being stored

### TypeScript errors

1. Ensure you're using the latest version
2. Check that types are properly imported
3. Verify your tsconfig includes the package

## Testing

The plugin includes comprehensive unit tests covering all major functionality.

### Quick Start

```bash
# Run all tests
pnpm test

# Run in watch mode
pnpm test:watch

# Generate coverage report
pnpm coverage

# Type check source code
pnpm typecheck
```

### Current Status

✅ **All 23 tests passing (100%)** - Production ready!

- ✅ **Webhook tests**: 12/12 passing
- ✅ **Client plugin**: 4/4 passing
- ✅ **Error codes**: 3/3 passing
- ✅ **Type safety**: 2/2 passing
- ✅ **Metadata**: 1/1 passing
- ✅ **Core functionality**: 1/1 passing

**📖 Detailed testing guide:** See [HOW_TO_TEST.md](./HOW_TO_TEST.md)

### Test Structure

Tests are organized in the `test/` directory:

- `chargebee.test.ts` - Main plugin tests (types, customer creation, subscriptions)
- `webhook.test.ts` - Webhook handler tests (event processing, authentication)

### Writing Tests

Example test for subscription upgrade:

```typescript
import { getTestInstance } from "better-auth/test";
import { chargebee } from "@chargebee/better-auth";
import { vi } from "vitest";

it("should upgrade subscription", async () => {
  const mockChargebee = {
    hostedPage: {
      checkoutExistingForItems: vi.fn().mockResolvedValue({
        hosted_page: {
          id: "hp_123",
          url: "https://test.chargebee.com/pages/hp_123",
        },
      }),
    },
  };

  const { auth, testUser } = await getTestInstance({
    plugins: [
      chargebee({
        chargebeeClient: mockChargebee as any,
        subscription: {
          enabled: true,
          plans: [{ name: "Pro", itemPriceId: "pro-plan", type: "plan" }],
        },
      }),
    ],
  });

  const user = await testUser.signUp({
    email: "test@example.com",
    name: "Test User",
  });

  // Test subscription upgrade logic
  await auth.api.upgradeSubscription({
    body: {
      itemPriceId: "pro-plan",
      successUrl: "http://localhost:3000/success",
      cancelUrl: "http://localhost:3000/cancel",
    },
  });

  expect(mockChargebee.hostedPage.checkoutExistingForItems).toHaveBeenCalled();
});
```

### Coverage

Run tests with coverage to ensure all code paths are tested:

```bash
pnpm coverage
```

This generates:
- Terminal coverage report
- HTML report in `coverage/` directory
- JSON report for CI/CD integration

### Mocking Chargebee Client

For testing, mock the Chargebee client methods:

```typescript
const mockChargebee = {
  customer: {
    create: vi.fn().mockResolvedValue({
      customer: { id: "cust_123", email: "test@example.com" },
    }),
    list: vi.fn().mockResolvedValue({ list: [] }),
    update: vi.fn().mockResolvedValue({ customer: { id: "cust_123" } }),
  },
  hostedPage: {
    checkoutNewForItems: vi.fn(),
    checkoutExistingForItems: vi.fn(),
  },
  subscription: {
    cancel: vi.fn(),
  },
} as unknown as Chargebee;
```

### CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm test
      - run: pnpm coverage
```

## Examples

See the [example implementation](https://github.com/chargebee/js-framework-adapters/tree/main/examples/next-chargebee-better-auth) for a complete Next.js application.

## License

MIT

## Support

- [Documentation](https://github.com/chargebee/js-framework-adapters/tree/main/packages/better-auth)
- [Report Issues](https://github.com/chargebee/js-framework-adapters/issues)
- [Chargebee Documentation](https://www.chargebee.com/docs/)
