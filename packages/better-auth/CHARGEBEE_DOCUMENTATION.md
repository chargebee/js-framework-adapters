# Chargebee

Chargebee plugin for Better Auth to manage subscriptions and payments.

The Chargebee plugin integrates Chargebee's subscription management and billing functionality with Better Auth. Since payment and authentication are often tightly coupled, this plugin simplifies the integration of Chargebee into your application, handling customer creation, subscription management, and webhook processing.

## Features

* Create Chargebee Customers automatically when users sign up
* Manage subscription plans and pricing with flexible item-based billing
* Process subscription lifecycle events (creation, updates, cancellations)
* Handle Chargebee webhooks securely with Basic Authentication
* Expose subscription data to your application
* Support for trial periods
* Flexible reference system to associate subscriptions with users or organizations
* Team subscription support with seats management
* Multi-item subscriptions (plans, addons, and charges)

## Quick Start

Here's a complete example to get you started quickly:

```typescript title="lib/auth.ts"
import { betterAuth } from "better-auth";
import { chargebee } from "@better-auth/chargebee";
import Chargebee from "chargebee";

// Initialize Chargebee client
const chargebeeClient = new Chargebee();
chargebeeClient.configure({
    site: process.env.CHARGEBEE_SITE!,
    api_key: process.env.CHARGEBEE_API_KEY!,
});

// Fetch plans from Chargebee (optional - can also define statically)
const plans = await chargebeeClient.itemPrice.list({
    item_type: { is: "plan" },
});

const confPlans = plans.list.map((plan) => ({
    name: plan.item_price.name,
    itemPriceId: plan.item_price.id,
    type: "plan" as const,
}));

export const auth = betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
        enabled: true,
    },
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

```typescript title="lib/auth-client.ts"
import { createAuthClient } from "better-auth/react";
import { chargebeeClient } from "@better-auth/chargebee/client";

export const authClient = createAuthClient({
    baseURL: process.env.NEXT_PUBLIC_APP_URL,
    plugins: [
        chargebeeClient({
            subscription: true,
        }),
    ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
```

For a complete working example, see the [example implementation](https://github.com/chargebee/js-framework-adapters/tree/main/examples/next-chargebee-better-auth).

## Installation

<Steps>
  <Step>
    ### Install the plugin

    First, install the plugin:

    <CodeBlockTabs defaultValue="npm" groupId="persist-install" persist>
      <CodeBlockTabsList>
        <CodeBlockTabsTrigger value="npm">
          npm
        </CodeBlockTabsTrigger>

        <CodeBlockTabsTrigger value="pnpm">
          pnpm
        </CodeBlockTabsTrigger>

        <CodeBlockTabsTrigger value="yarn">
          yarn
        </CodeBlockTabsTrigger>

        <CodeBlockTabsTrigger value="bun">
          bun
        </CodeBlockTabsTrigger>
      </CodeBlockTabsList>

      <CodeBlockTab value="npm">
        ```bash
        npm install @better-auth/chargebee
        ```
      </CodeBlockTab>

      <CodeBlockTab value="pnpm">
        ```bash
        pnpm add @better-auth/chargebee
        ```
      </CodeBlockTab>

      <CodeBlockTab value="yarn">
        ```bash
        yarn add @better-auth/chargebee
        ```
      </CodeBlockTab>

      <CodeBlockTab value="bun">
        ```bash
        bun add @better-auth/chargebee
        ```
      </CodeBlockTab>
    </CodeBlockTabs>

    <Callout>
      If you're using a separate client and server setup, make sure to install the plugin in both parts of your project.
    </Callout>
  </Step>

  <Step>
    ### Install the Chargebee SDK

    Next, install the Chargebee SDK on your server:

    <CodeBlockTabs defaultValue="npm" groupId="persist-install" persist>
      <CodeBlockTabsList>
        <CodeBlockTabsTrigger value="npm">
          npm
        </CodeBlockTabsTrigger>

        <CodeBlockTabsTrigger value="pnpm">
          pnpm
        </CodeBlockTabsTrigger>

        <CodeBlockTabsTrigger value="yarn">
          yarn
        </CodeBlockTabsTrigger>

        <CodeBlockTabsTrigger value="bun">
          bun
        </CodeBlockTabsTrigger>
      </CodeBlockTabsList>

      <CodeBlockTab value="npm">
        ```bash
        npm install chargebee
        ```
      </CodeBlockTab>

      <CodeBlockTab value="pnpm">
        ```bash
        pnpm add chargebee
        ```
      </CodeBlockTab>

      <CodeBlockTab value="yarn">
        ```bash
        yarn add chargebee
        ```
      </CodeBlockTab>

      <CodeBlockTab value="bun">
        ```bash
        bun add chargebee
        ```
      </CodeBlockTab>
    </CodeBlockTabs>
  </Step>

  <Step>
    ### Add the plugin to your auth config

    ```ts title="auth.ts"
    import { betterAuth } from "better-auth"
    import { chargebee } from "@better-auth/chargebee"
    import Chargebee from "chargebee"

    const chargebeeClient = new Chargebee()
    chargebeeClient.configure({
        site: process.env.CHARGEBEE_SITE!,
        api_key: process.env.CHARGEBEE_API_KEY!,
    })

    export const auth = betterAuth({
        // ... your existing config
        plugins: [
            chargebee({
                chargebeeClient,
                webhookUsername: process.env.CHARGEBEE_WEBHOOK_USERNAME,
                webhookPassword: process.env.CHARGEBEE_WEBHOOK_PASSWORD,
                createCustomerOnSignUp: true,
            })
        ]
    })
    ```

    <Callout type="info">
      **Webhook Authentication:** For production use, it's highly recommended to configure `webhookUsername` and `webhookPassword` to secure your webhook endpoint with Basic Authentication.
    </Callout>
  </Step>

  <Step>
    ### Add the client plugin

    ```ts title="auth-client.ts"
    import { createAuthClient } from "better-auth/client"
    import { chargebeeClient } from "@better-auth/chargebee/client"

    export const authClient = createAuthClient({
        // ... your existing config
        plugins: [
            chargebeeClient({
                subscription: true // if you want to enable subscription management
            })
        ]
    })
    ```
  </Step>

  <Step>
    ### Migrate the database

    Run the migration or generate the schema to add the necessary tables to the database.

    <Tabs items={["migrate", "generate"]}>
      <Tab value="migrate">
        <CodeBlockTabs defaultValue="npm" groupId="persist-install" persist>
          <CodeBlockTabsList>
            <CodeBlockTabsTrigger value="npm">
              npm
            </CodeBlockTabsTrigger>

            <CodeBlockTabsTrigger value="pnpm">
              pnpm
            </CodeBlockTabsTrigger>

            <CodeBlockTabsTrigger value="yarn">
              yarn
            </CodeBlockTabsTrigger>

            <CodeBlockTabsTrigger value="bun">
              bun
            </CodeBlockTabsTrigger>
          </CodeBlockTabsList>

          <CodeBlockTab value="npm">
            ```bash
            npx @better-auth/cli migrate
            ```
          </CodeBlockTab>

          <CodeBlockTab value="pnpm">
            ```bash
            pnpm dlx @better-auth/cli migrate
            ```
          </CodeBlockTab>

          <CodeBlockTab value="yarn">
            ```bash
            yarn dlx @better-auth/cli migrate
            ```
          </CodeBlockTab>

          <CodeBlockTab value="bun">
            ```bash
            bun x @better-auth/cli migrate
            ```
          </CodeBlockTab>
        </CodeBlockTabs>
      </Tab>

      <Tab value="generate">
        <CodeBlockTabs defaultValue="npm" groupId="persist-install" persist>
          <CodeBlockTabsList>
            <CodeBlockTabsTrigger value="npm">
              npm
            </CodeBlockTabsTrigger>

            <CodeBlockTabsTrigger value="pnpm">
              pnpm
            </CodeBlockTabsTrigger>

            <CodeBlockTabsTrigger value="yarn">
              yarn
            </CodeBlockTabsTrigger>

            <CodeBlockTabsTrigger value="bun">
              bun
            </CodeBlockTabsTrigger>
          </CodeBlockTabsList>

          <CodeBlockTab value="npm">
            ```bash
            npx @better-auth/cli generate
            ```
          </CodeBlockTab>

          <CodeBlockTab value="pnpm">
            ```bash
            pnpm dlx @better-auth/cli generate
            ```
          </CodeBlockTab>

          <CodeBlockTab value="yarn">
            ```bash
            yarn dlx @better-auth/cli generate
            ```
          </CodeBlockTab>

          <CodeBlockTab value="bun">
            ```bash
            bun x @better-auth/cli generate
            ```
          </CodeBlockTab>
        </CodeBlockTabs>
      </Tab>
    </Tabs>

    See the [Schema](#schema) section to add the tables manually.
  </Step>

  <Step>
    ### Set up Chargebee webhooks

    Create a webhook endpoint in your Chargebee dashboard pointing to:

    ```
    https://your-domain.com/api/auth/chargebee/webhook
    ```

    `/api/auth` is the default path for the auth server.

    Make sure to select at least these events:

    * `subscription_created`
    * `subscription_activated`
    * `subscription_changed`
    * `subscription_renewed`
    * `subscription_started`
    * `subscription_cancelled`
    * `subscription_cancellation_scheduled`
    * `customer_deleted`

    If you configured `webhookUsername` and `webhookPassword` in your plugin options, make sure to add the same Basic Authentication credentials in the Chargebee webhook settings.
  </Step>

  <Step>
    ### Environment Variables

    Add these environment variables to your `.env` file:

    ```env
    # Better Auth
    BETTER_AUTH_SECRET=your-secret-key-here
    BETTER_AUTH_URL=http://localhost:3000

    # Chargebee
    CHARGEBEE_SITE=your-site-name
    CHARGEBEE_API_KEY=your-api-key

    # Webhook Authentication (Recommended for production)
    CHARGEBEE_WEBHOOK_USERNAME=your-webhook-username
    CHARGEBEE_WEBHOOK_PASSWORD=your-webhook-password
    ```
  </Step>
</Steps>

## Usage

### Customer Management

You can use this plugin solely for customer management without enabling subscriptions. This is useful if you just want to link Chargebee customers to your users.

When you set `createCustomerOnSignUp: true`, a Chargebee customer is automatically created on signup and linked to the user in your database.
You can customize the customer creation process:

```ts title="auth.ts"
chargebee({
    // ... other options
    createCustomerOnSignUp: true,
    onCustomerCreate: async ({ chargebeeCustomer, user }) => {
        // Do something with the newly created customer
        console.log(`Customer ${chargebeeCustomer.id} created for user ${user.id}`);
    },
})
```

### Subscription Management

#### Defining Plans

Chargebee uses an item-based billing model. You can define your subscription plans using item price IDs:

```ts title="auth.ts"
// Static plans
subscription: {
    enabled: true,
    plans: [
        {
            name: "starter", // the name of the plan
            itemPriceId: "starter-USD-Monthly", // the item price ID from Chargebee
            type: "plan",
            limits: {
                projects: 5,
                storage: 10
            }
        },
        {
            name: "pro",
            itemPriceId: "pro-USD-Monthly",
            type: "plan",
            limits: {
                projects: 20,
                storage: 50
            },
            freeTrial: {
                days: 14,
            }
        }
    ]
}

// Dynamic plans (fetched from database or API)
subscription: {
    enabled: true,
    plans: async () => {
        const plans = await db.query("SELECT * FROM plans");
        return plans.map(plan => ({
            name: plan.name,
            itemPriceId: plan.chargebee_item_price_id,
            type: "plan",
            limits: JSON.parse(plan.limits)
        }));
    }
}
```

see [plan configuration](#plan-configuration) for more.

#### Creating a Subscription

To create a subscription, use the `subscription.upgrade` method:


### Client Side

```ts
const { data, error } = await authClient.subscription.upgrade({
    itemPriceId: "pro-USD-Monthly",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
    referenceId: "123", // optional
    subscriptionId: "sub_123", // optional
    metadata: {}, // optional
    customerType: "user", // optional
    seats: 1, // optional
    returnUrl: "/account", // optional
    disableRedirect: false, // optional
    trialEnd: 1735689600, // optional Unix timestamp
});
```

### Server Side

```ts
const data = await auth.api.upgradeSubscription({
    body: {
        itemPriceId: "pro-USD-Monthly",
        successUrl: "/dashboard",
        cancelUrl: "/pricing",
        referenceId: "123", // optional
        subscriptionId: "sub_123", // optional
        metadata: {}, // optional
        customerType: "user", // optional
        seats: 1, // optional
        returnUrl: "/account", // optional
        disableRedirect: false, // optional
        trialEnd: 1735689600, // optional Unix timestamp
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type upgradeSubscription = {
      /**
       * The item price ID(s) from Chargebee. Can be a single string or array of strings for multi-item subscriptions.
       */
      itemPriceId: string | string[]
      /**
       * The URL to which Chargebee should send customers when checkout is complete.
       */
      successUrl: string
      /**
       * If set, checkout shows a back button and customers will be directed here if they cancel.
       */
      cancelUrl: string
      /**
       * Reference id of the subscription. Defaults based on customerType.
       */
      referenceId?: string = "123"
      /**
       * The id of the subscription to upgrade.
       */
      subscriptionId?: string = "sub_123"
      /**
       * Additional metadata to store with the subscription.
       */
      metadata?: Record<string, unknown>
      /**
       * The type of customer for billing. (Default: "user")
       */
      customerType?: "user" | "organization"
      /**
       * Number of seats for the subscription (if applicable).
       */
      seats?: number = 1
      /**
       * The URL to return to from the portal (used when upgrading existing subscriptions)
       */
      returnUrl?: string = "/account"
      /**
       * Disable redirect after successful subscription.
       */
      disableRedirect?: boolean = false
      /**
       * Unix timestamp for when the trial should end. Only applicable for new subscriptions.
       */
      trialEnd?: number = 1735689600

}
```


**Simple Example:**

```ts title="client.ts"
await authClient.subscription.upgrade({
    itemPriceId: "pro-USD-Monthly",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
    seats: 5, // Optional: for team plans
});
```

This will create a Chargebee Hosted Page and redirect the user to the Chargebee checkout page.

<Callout type="info">
  The plugin supports one active or trialing subscription per reference ID (user or organization) at a time. Multiple concurrent subscriptions for the same reference ID are not supported.

  If the user already has an active subscription, you **must** provide the `subscriptionId` parameter when upgrading. Otherwise, a new subscription may be created alongside the existing one, resulting in duplicate billing.
</Callout>

> **Important:** The `successUrl` parameter will be internally modified to handle race conditions between checkout completion and webhook processing. The plugin creates an intermediate redirect that ensures subscription status is properly updated before redirecting to your success page.

```ts
const { error } = await authClient.subscription.upgrade({
    itemPriceId: "pro-USD-Monthly",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
});
if(error) {
    alert(error.message);
}
```

#### Multi-Item Subscriptions

Chargebee supports adding multiple items to a single subscription (plans, addons, charges):

```ts title="client.ts"
await authClient.subscription.upgrade({
    itemPriceId: [
        "pro-plan-USD-Monthly",
        "priority-support-addon-USD-Monthly",
        "onboarding-charge-USD"
    ],
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
});
```

#### Switching Plans

To switch a subscription to a different plan, use the `subscription.upgrade` method with the subscription ID:

```ts title="client.ts"
await authClient.subscription.upgrade({
    itemPriceId: "enterprise-USD-Monthly",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
    subscriptionId: "sub_123", // the Chargebee subscription ID of the user's current plan
});
```

This ensures that the user only pays for the new plan, and not both.

#### Canceling a Subscription

To cancel a subscription:


### Client Side

```ts
const { data, error } = await authClient.subscription.cancel({
    referenceId: "org_123", // optional
    customerType: "user", // optional
    subscriptionId: "sub_123", // optional
    returnUrl: "/account",
    disableRedirect: false, // optional
});
```

### Server Side

```ts
const data = await auth.api.cancelSubscription({
    body: {
        referenceId: "org_123", // optional
        customerType: "user", // optional
        subscriptionId: "sub_123", // optional
        returnUrl: "/account",
        disableRedirect: false, // optional
    },
    // This endpoint requires session cookies.
    headers: await headers()
});
```

### Type Definition

```ts
type cancelSubscription = {
      /**
       * Reference id of the subscription to cancel. Defaults based on customerType.
       */
      referenceId?: string = "org_123"
      /**
       * The type of customer for billing. (Default: "user")
       */
      customerType?: "user" | "organization"
      /**
       * The id of the subscription to cancel.
       */
      subscriptionId?: string = "sub_123"
      /**
       * URL to return to after cancellation.
       */
      returnUrl: string = "/account"
      /**
       * Disable redirect after cancellation.
       */
      disableRedirect?: boolean = false

}
```


This will redirect the user to the Chargebee Portal where they can cancel their subscription.

<Callout type="info">
  **Understanding Cancellation States**

  Chargebee supports different cancellation behaviors, and the plugin tracks them:

  | Field        | Description                                                                                           |
  | ------------ | ----------------------------------------------------------------------------------------------------- |
  | `canceledAt` | If the subscription has been canceled, this is the time when it was canceled.                         |
  | `status`     | Changes to "cancelled" when the subscription has ended.                                               |
</Callout>

### Reference System

By default, subscriptions are associated with the user ID. However, you can use a custom reference ID to associate subscriptions with other entities, such as organizations:

```ts title="client.ts"
// Create a subscription for an organization
await authClient.subscription.upgrade({
    itemPriceId: "team-plan-USD-Monthly",
    referenceId: "org_123456",
    customerType: "organization",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
    seats: 5 // Number of seats for team plans
});
```

#### Team Subscriptions with Seats

For team or organization plans, you can specify the number of seats:

```ts
await authClient.subscription.upgrade({
    itemPriceId: "team-USD-Monthly",
    referenceId: "org_123456",
    customerType: "organization",
    seats: 10, // 10 team members
    successUrl: "/org/billing/success",
    cancelUrl: "/org/billing"
});
```

The `seats` parameter is passed to Chargebee as the quantity for the subscription item. You can use this value in your application logic to limit the number of members in a team or organization.

To authorize reference IDs, implement the `authorizeReference` function:

```ts title="auth.ts"
subscription: {
    // ... other options
    authorizeReference: async ({ user, session, referenceId, action }) => {
        // Check if the user has permission to manage subscriptions for this reference
        if (action === "upgrade-subscription" || action === "cancel-subscription") {
            const org = await db.member.findFirst({
                where: {
                    organizationId: referenceId,
                    userId: user.id
                }
            });
            return org?.role === "owner"
        }
        return true;
    }
}
```

### Webhook Handling

The plugin automatically handles common webhook events:

* `subscription_created`: Creates a subscription when created
* `subscription_activated`: Updates subscription when activated
* `subscription_changed`: Updates subscription details when changed
* `subscription_renewed`: Updates subscription on renewal
* `subscription_started`: Updates subscription when trial ends and subscription starts
* `subscription_cancelled`: Marks subscription as canceled
* `subscription_cancellation_scheduled`: Updates subscription with scheduled cancellation
* `customer_deleted`: Cleans up customer data and associated subscriptions

You can also handle custom events:

```ts title="auth.ts"
chargebee({
    // ... other options
    onEvent: async (event) => {
        // Handle any Chargebee event
        switch (event.event_type) {
            case "payment_succeeded":
                // Handle successful payment
                break;
            case "invoice_generated":
                // Handle generated invoice
                break;
        }
    }
})
```

### Subscription Lifecycle Hooks

You can hook into various subscription lifecycle events:

```ts title="auth.ts"
subscription: {
    // ... other options
    onSubscriptionComplete: async ({ subscription, chargebeeSubscription }) => {
        // Called when a subscription is successfully completed via hosted page
        await sendWelcomeEmail(subscription.referenceId);
    },
    onSubscriptionCreated: async ({ subscription, chargebeeSubscription }) => {
        // Called when a subscription is created
        await sendSubscriptionCreatedEmail(subscription.referenceId);
    },
    onSubscriptionUpdate: async ({ subscription }) => {
        // Called when a subscription is updated
        console.log(`Subscription ${subscription.id} updated`);
    },
    onSubscriptionDeleted: async ({ subscription, chargebeeSubscription }) => {
        // Called when a subscription is canceled/deleted
        await sendCancellationEmail(subscription.referenceId);
    },
    onTrialStart: async ({ subscription }) => {
        // Called when a trial starts
        await sendTrialStartEmail(subscription.referenceId);
    },
    onTrialEnd: async ({ subscription }) => {
        // Called when a trial ends
        await sendTrialEndEmail(subscription.referenceId);
    }
}
```

### Trial Periods

You can configure trial periods for your plans:

```ts title="auth.ts"
{
    name: "pro",
    itemPriceId: "pro-USD-Monthly",
    type: "plan",
    freeTrial: {
        days: 14,
    }
}
```

To set a custom trial end date, pass the `trialEnd` parameter (Unix timestamp):

```ts title="client.ts"
// Set trial to end on January 1, 2025
await authClient.subscription.upgrade({
    itemPriceId: "pro-USD-Monthly",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
    trialEnd: 1735689600, // Unix timestamp for Jan 1, 2025
});
```

## Practical Examples

### Building a Pricing Page

```typescript title="app/pricing/page.tsx"
"use client";

import { useState, useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export default function PricingPage() {
    const [plans, setPlans] = useState([]);
    const { data: session } = authClient.useSession();
    const router = useRouter();

    const handleUpgrade = async (plan) => {
        if (!session?.user) {
            router.push("/login");
            return;
        }

        const response = await fetch("/api/subscription/upgrade", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                itemPriceId: plan.itemPriceId,
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
        <div className="grid grid-cols-3 gap-4">
            {plans.map((plan) => (
                <div key={plan.id} className="border rounded p-6">
                    <h3 className="text-2xl font-bold">{plan.name}</h3>
                    <p className="text-gray-600">{plan.description}</p>
                    <div className="mt-4">
                        <span className="text-3xl font-bold">${plan.price}</span>
                        <span className="text-gray-500">/month</span>
                    </div>
                    <button
                        onClick={() => handleUpgrade(plan)}
                        className="mt-6 w-full bg-blue-600 text-white py-2 rounded"
                    >
                        Subscribe
                    </button>
                </div>
            ))}
        </div>
    );
}
```

### Server-Side Subscription Management

```typescript title="app/api/subscription/upgrade/route.ts"
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
    const body = await request.json();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    try {
        const result = await auth.api.upgradeSubscription({
            body: {
                itemPriceId: body.itemPriceId,
                successUrl: `${baseUrl}/dashboard?success=true`,
                cancelUrl: `${baseUrl}/pricing?canceled=true`,
                trialEnd: body.trialEnd, // Optional: Unix timestamp
                seats: body.seats, // Optional: for team plans
            },
            headers: await headers(),
        });

        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(
            { error: error.message },
            { status: 400 }
        );
    }
}
```

### Canceling Subscriptions

```typescript title="components/CancelSubscriptionButton.tsx"
"use client";

import { useState } from "react";

export function CancelSubscriptionButton({ subscription }) {
    const [loading, setLoading] = useState(false);

    const handleCancelSubscription = async () => {
        if (!confirm("Are you sure you want to cancel your subscription?")) {
            return;
        }

        setLoading(true);

        try {
            const response = await fetch("/api/subscription/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    subscriptionId: subscription.chargebeeSubscriptionId,
                    returnUrl: window.location.origin + "/account",
                }),
            });

            const data = await response.json();

            // Redirect to Chargebee cancellation portal
            if (data.url) {
                window.location.href = data.url;
            }
        } catch (error) {
            console.error("Cancellation error:", error);
            alert("Failed to cancel subscription");
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            onClick={handleCancelSubscription}
            disabled={loading}
            className="bg-red-600 text-white px-4 py-2 rounded"
        >
            {loading ? "Processing..." : "Cancel Subscription"}
        </button>
    );
}
```

### Displaying Subscription Status

```typescript title="app/api/subscription/status/route.ts"
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

```typescript title="components/SubscriptionStatus.tsx"
"use client";

import { useEffect, useState } from "react";

export function SubscriptionStatus() {
    const [subscription, setSubscription] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/subscription/status")
            .then((res) => res.json())
            .then((data) => {
                setSubscription(data.subscription);
                setLoading(false);
            });
    }, []);

    if (loading) return <div>Loading...</div>;

    if (!subscription) {
        return (
            <div className="bg-gray-100 p-4 rounded">
                <p>No active subscription</p>
                <a href="/pricing" className="text-blue-600">
                    View Plans
                </a>
            </div>
        );
    }

    return (
        <div className="bg-white border rounded p-6">
            <h3 className="text-xl font-bold mb-4">Your Subscription</h3>
            <div className="space-y-2">
                <p>
                    <strong>Status:</strong>{" "}
                    <span className="capitalize">{subscription.status}</span>
                </p>
                <p>
                    <strong>Period:</strong>{" "}
                    {new Date(subscription.periodStart).toLocaleDateString()} -{" "}
                    {new Date(subscription.periodEnd).toLocaleDateString()}
                </p>
                {subscription.trialEnd && (
                    <p>
                        <strong>Trial Ends:</strong>{" "}
                        {new Date(subscription.trialEnd).toLocaleDateString()}
                    </p>
                )}
            </div>
        </div>
    );
}
```

## Webhook Setup

### Configuring Webhook Endpoints

You can configure webhook endpoints either through the Chargebee dashboard or programmatically via API.

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
   - `subscription_started`
   - `subscription_cancelled`
   - `subscription_cancellation_scheduled`
   - `customer_deleted`

#### Option B: Programmatically via API

```typescript
import Chargebee from "chargebee";

const chargebeeClient = new Chargebee();
chargebeeClient.configure({
    site: process.env.CHARGEBEE_SITE!,
    api_key: process.env.CHARGEBEE_API_KEY!,
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

### Local Testing

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

### Managing Webhooks Programmatically

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

## API Reference

### Available Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/chargebee/webhook` | POST | Webhook handler for Chargebee events |
| `/api/auth/subscription/upgrade` | POST | Create or upgrade subscription |
| `/api/auth/subscription/cancel` | POST | Cancel subscription |
| `/api/auth/subscription/cancel/callback` | GET | Handle cancellation callback |

### Request/Response Examples

#### Upgrade Subscription

**Request:**
```typescript
POST /api/auth/subscription/upgrade

{
  itemPriceId: string | string[];  // Single or multiple item prices
  subscriptionId?: string;          // For upgrades
  successUrl: string;
  cancelUrl: string;
  trialEnd?: number;                // Unix timestamp
  seats?: number;                   // For seat-based plans
  metadata?: Record<string, any>;
  customerType?: "user" | "organization";
  referenceId?: string;
}
```

**Response:**
```typescript
{
  url: string;      // Chargebee hosted page URL
  id: string;       // Hosted page ID
  redirect: boolean;
}
```

#### Cancel Subscription

**Request:**
```typescript
POST /api/auth/subscription/cancel

{
  subscriptionId?: string;
  referenceId?: string;
  customerType?: "user" | "organization";
  returnUrl: string;
  disableRedirect?: boolean;
}
```

**Response:**
```typescript
{
  url: string;      // Chargebee cancellation portal URL
  redirect: boolean;
}
```

## Schema

The Chargebee plugin adds the following tables to your database:

### User

Table Name: `user`

<DatabaseTable
  fields={[
  {
    name: "chargebeeCustomerId",
    type: "string",
    description: "The Chargebee customer ID",
    isOptional: true,
    isUnique: true
  },
]}
/>

### Organization

Table Name: `organization` <small className="text-xs">(only when `organization.enabled` is `true`)</small>

<DatabaseTable
  fields={[
  {
    name: "chargebeeCustomerId",
    type: "string",
    description: "The Chargebee customer ID for the organization",
    isOptional: true,
    isUnique: true
  },
]}
/>

### Subscription

Table Name: `subscription`

<DatabaseTable
  fields={[
  {
    name: "id",
    type: "string",
    description: "Unique identifier for each subscription",
    isPrimaryKey: true
  },
  {
    name: "referenceId",
    type: "string",
    description: "The ID this subscription is associated with (user ID by default). This should NOT be a unique field in your database, as it must allow users to resubscribe after a cancellation.",
    isUnique: false
  },
  {
    name: "chargebeeCustomerId",
    type: "string",
    description: "The Chargebee customer ID",
    isOptional: true
  },
  {
    name: "chargebeeSubscriptionId",
    type: "string",
    description: "The Chargebee subscription ID",
    isOptional: true,
    isUnique: true
  },
  {
    name: "status",
    type: "string",
    description: "The status of the subscription (future, in_trial, active, non_renewing, paused, cancelled, transferred)",
    defaultValue: "future"
  },
  {
    name: "periodStart",
    type: "Date",
    description: "Start date of the current billing period",
    isOptional: true
  },
  {
    name: "periodEnd",
    type: "Date",
    description: "End date of the current billing period",
    isOptional: true
  },
  {
    name: "trialStart",
    type: "Date",
    description: "Start date of the trial period",
    isOptional: true
  },
  {
    name: "trialEnd",
    type: "Date",
    description: "End date of the trial period",
    isOptional: true
  },
  {
    name: "canceledAt",
    type: "Date",
    description: "If the subscription has been canceled, this is the time when it was canceled",
    isOptional: true
  },
  {
    name: "seats",
    type: "number",
    description: "Number of seats for team plans",
    isOptional: true
  },
  {
    name: "metadata",
    type: "string",
    description: "JSON string of additional metadata",
    isOptional: true
  }
]}
/>

### Subscription Item

Table Name: `subscriptionItem`

<DatabaseTable
  fields={[
  {
    name: "id",
    type: "string",
    description: "Unique identifier for each subscription item",
    isPrimaryKey: true
  },
  {
    name: "subscriptionId",
    type: "string",
    description: "Foreign key reference to the subscription"
  },
  {
    name: "itemPriceId",
    type: "string",
    description: "The Chargebee item price ID"
  },
  {
    name: "itemType",
    type: "string",
    description: "Type of item (plan, addon, or charge)"
  },
  {
    name: "quantity",
    type: "number",
    description: "Quantity of this item"
  },
  {
    name: "unitPrice",
    type: "number",
    description: "Unit price of the item",
    isOptional: true
  },
  {
    name: "amount",
    type: "number",
    description: "Total amount for this item",
    isOptional: true
  }
]}
/>

## Options

| Option                   | Type       | Description                                                                               |
| ------------------------ | ---------- | ----------------------------------------------------------------------------------------- |
| `chargebeeClient`        | `Chargebee`| The Chargebee client instance. **Required.**                                              |
| `webhookUsername`        | `string`   | Username for Basic Authentication on webhook endpoint. Recommended for production.        |
| `webhookPassword`        | `string`   | Password for Basic Authentication on webhook endpoint. Recommended for production.        |
| `createCustomerOnSignUp` | `boolean`  | Whether to automatically create a Chargebee customer when a user signs up. Default: `false`. |
| `onCustomerCreate`       | `function` | Callback called after a customer is created. Receives `{ chargebeeCustomer, user }`.      |
| `onEvent`                | `function` | Callback called for any Chargebee webhook event. Receives the webhook event object.      |
| `subscription`           | `object`   | Subscription configuration. See [below](#subscription-options).                           |
| `organization`           | `object`   | Enable Organization Customer support. See [below](#organization-options).                 |

### Subscription Options

| Option                     | Type                         | Description                                                                                                    |
| -------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `enabled`                  | `boolean`                    | Whether to enable subscription functionality. **Required.**                                                    |
| `plans`                    | `ChargebeePlan[]` or `function` | An array of subscription plans or an async function that returns plans. **Required** if enabled.          |
| `preventDuplicateTrails`   | `boolean`                    | Whether to prevent users from getting multiple trials. Default: `false`.                                       |
| `requireEmailVerification` | `boolean`                    | Whether to require email verification before allowing subscription upgrades. Default: `false`.                 |
| `authorizeReference`       | `function`                   | Authorize reference IDs. Receives `{ user, session, referenceId, action }`.                                    |
| `getHostedPageParams`      | `function`                   | Customize Chargebee Hosted Page parameters. Receives `{ user, session, plan, subscription }`, request, and context. |
| `onSubscriptionComplete`   | `function`                   | Called when a subscription is completed via hosted page. Receives `{ subscription, chargebeeSubscription }`.   |
| `onSubscriptionCreated`    | `function`                   | Called when a subscription is created. Receives `{ subscription, chargebeeSubscription }`.                     |
| `onSubscriptionUpdate`     | `function`                   | Called when a subscription is updated. Receives `{ subscription }`.                                            |
| `onSubscriptionDeleted`    | `function`                   | Called when a subscription is deleted. Receives `{ subscription, chargebeeSubscription }`.                     |
| `onTrialStart`             | `function`                   | Called when a trial starts. Receives `{ subscription }`.                                                       |
| `onTrialEnd`               | `function`                   | Called when a trial ends. Receives `{ subscription }`.                                                         |

#### Plan Configuration

| Option            | Type     | Description                                                  |
| ----------------- | -------- | ------------------------------------------------------------ |
| `name`            | `string` | The name of the plan. **Required.**                          |
| `itemPriceId`     | `string` | The Chargebee item price ID. **Required.**                   |
| `itemId`          | `string` | The Chargebee item ID. Optional.                             |
| `itemFamilyId`    | `string` | The Chargebee item family ID. Optional.                      |
| `type`            | `string` | Type of item: "plan", "addon", or "charges". **Required.**   |
| `trialPeriod`     | `number` | Trial period length. Optional.                               |
| `trialPeriodUnit` | `string` | Trial period unit: "day" or "month". Optional.               |
| `billingCycles`   | `number` | Number of billing cycles. Optional.                          |
| `freeTrial`       | `object` | Free trial configuration. See [below](#free-trial-configuration). |
| `limits`          | `object` | Limits for plan (e.g. `{ projects: 10, storage: 5 }`).      |

#### Free Trial Configuration

| Option | Type     | Description                          |
| ------ | -------- | ------------------------------------ |
| `days` | `number` | Number of trial days. **Required.**  |

### Organization Options

| Option           | Type       | Description                                                                                                |
| ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `enabled`        | `boolean`  | Enable Organization Customer support. **Required.**                                                        |
| `getCustomerCreateParams` | `function` | Customize Chargebee customer creation parameters for organizations. Receives `organization` and context. |
| `onCustomerCreate` | `function` | Called after an organization customer is created. Receives `{ chargebeeCustomer, organization }` and context. |

## Advanced Usage

### Using with Organizations

The Chargebee plugin integrates with the [organization plugin](/docs/plugins/organization) to enable organizations as Chargebee Customers. Instead of individual users, organizations become the billing entity for subscriptions. This is useful for B2B services where billing is tied to the organization rather than individual user.

<Callout type="info">
  **When Organization Customer is enabled:**

  * A Chargebee Customer is automatically created when an organization first subscribes
  * Organization name changes are synced to the Chargebee Customer
  * Organizations with active subscriptions cannot be deleted
</Callout>

#### Enabling Organization Customer

To enable Organization Customer, set `organization.enabled` to `true` and ensure the organization plugin is installed:

```ts title="auth.ts"
plugins: [
    organization(),
    chargebee({
        // ... other options
        subscription: {
            enabled: true,
            plans: [...],
        },
        organization: { // [!code highlight]
            enabled: true // [!code highlight]
        } // [!code highlight]
    })
]
```

#### Creating Organization Subscriptions

Even with Organization Customer enabled, user subscriptions remain available and are the default. To use the organization as the billing entity, pass `customerType: "organization"`:

```ts title="client.ts"
await authClient.subscription.upgrade({
    itemPriceId: "team-USD-Monthly",
    referenceId: activeOrg.id,
    customerType: "organization", // [!code highlight]
    seats: 10,
    successUrl: "/org/billing/success",
    cancelUrl: "/org/billing"
});
```

#### Authorization

Make sure to implement the `authorizeReference` function to verify that the user has permission to manage subscriptions for the organization:

```ts title="auth.ts"
subscription: {
    // ... other subscription options
    authorizeReference: async ({ user, referenceId, action }) => {
        const member = await db.members.findFirst({
            where: {
                userId: user.id,
                organizationId: referenceId
            }
        });

        return member?.role === "owner" || member?.role === "admin";
    }
}
```

### Custom Hosted Page Parameters

You can customize the Chargebee Hosted Page with additional parameters:

```ts title="auth.ts"
getHostedPageParams: async ({ user, session, plan, subscription }, request, ctx) => {
    return {
        embed: false,
        layout: "in_app",
        pass_thru_content: JSON.stringify({
            userId: user.id,
            planType: "business"
        }),
        redirect_url: "https://yourdomain.com/success",
        cancel_url: "https://yourdomain.com/cancel"
    };
}
```

## Error Handling

The plugin exports typed error codes for better error handling:

```typescript
import { CHARGEBEE_ERROR_CODES } from "@better-auth/chargebee";

// Available error codes
CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED                    // "You're already subscribed to this plan"
CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND                // "Subscription not found"
CHARGEBEE_ERROR_CODES.PLAN_NOT_FOUND                        // "Plan not found"
CHARGEBEE_ERROR_CODES.CUSTOMER_NOT_FOUND                    // "Chargebee customer not found for this user"
CHARGEBEE_ERROR_CODES.ORGANIZATION_NOT_FOUND                // "Organization not found"
CHARGEBEE_ERROR_CODES.UNAUTHORIZED_REFERENCE                // "Unauthorized access to this reference"
CHARGEBEE_ERROR_CODES.ACTIVE_SUBSCRIPTION_EXISTS            // "An active subscription already exists"
CHARGEBEE_ERROR_CODES.ORG_HAS_ACTIVE_SUBSCRIPTIONS         // "Cannot delete organization with active subscriptions"
CHARGEBEE_ERROR_CODES.WEBHOOK_VERIFICATION_FAILED           // "Webhook verification failed"
CHARGEBEE_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED           // "Email verification is required before you can subscribe"
CHARGEBEE_ERROR_CODES.UNABLE_TO_CREATE_CUSTOMER             // "Unable to create Chargebee customer"
CHARGEBEE_ERROR_CODES.ORGANIZATION_SUBSCRIPTION_NOT_ENABLED // "Organization subscription is not enabled"
CHARGEBEE_ERROR_CODES.AUTHORIZE_REFERENCE_REQUIRED          // "Organization subscriptions require authorizeReference callback"
CHARGEBEE_ERROR_CODES.ORGANIZATION_REFERENCE_ID_REQUIRED    // "Reference ID is required"
```

Handle errors in your application:

```typescript
try {
    await auth.api.upgradeSubscription({
        body: {
            itemPriceId: "pro-USD-Monthly",
            successUrl: "/dashboard",
            cancelUrl: "/pricing",
        },
        headers: await headers()
    });
} catch (error) {
    if (error.code === CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED) {
        // User already has this subscription
        console.log("You're already subscribed to this plan");
    } else if (error.code === CHARGEBEE_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED) {
        // Email verification required
        console.log("Please verify your email before subscribing");
    } else {
        // Handle other errors
        console.error("Subscription error:", error.message);
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
    SubscriptionItem,
} from "@better-auth/chargebee";

// Types are automatically inferred from your configuration
const subscription: Subscription = {
    id: "sub_123",
    referenceId: "user_123",
    status: "active",
    periodStart: new Date(),
    periodEnd: new Date(),
    // ... TypeScript will validate all fields
};

// Plan configuration with type safety
const plan: ChargebeePlan = {
    name: "pro",
    itemPriceId: "pro-USD-Monthly",
    type: "plan",
    limits: {
        projects: 20,
        storage: 100
    },
    freeTrial: {
        days: 14
    }
};
```

## Troubleshooting

### Webhook Issues

If webhooks aren't being processed correctly:

1. Check that your webhook URL is correctly configured in the Chargebee dashboard
2. Verify that the webhook username and password match between your configuration and Chargebee settings
3. Ensure you've selected all the necessary events in the Chargebee dashboard
4. Check your server logs for any errors during webhook processing
5. Verify that webhook authentication is working (check for 401 errors in logs)

### Subscription Status Issues

If subscription statuses aren't updating correctly:

1. Make sure the webhook events are being received and processed
2. Check that the `chargebeeCustomerId` and `chargebeeSubscriptionId` fields are correctly populated
3. Verify that the reference IDs match between your application and Chargebee
4. Check your application logs for webhook processing errors
5. Ensure database schema matches plugin requirements

### TypeScript Errors

1. Ensure you're using the latest version of the plugin
2. Check that types are properly imported from `@better-auth/chargebee`
3. Verify your tsconfig includes the package
4. Run `npm install` to ensure all dependencies are up to date

### Testing Webhooks Locally

See the [Webhook Setup](#webhook-setup) section for detailed instructions on testing webhooks locally using ngrok.

## Testing

The plugin includes comprehensive unit tests covering all major functionality.

### Running Tests

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

### Test Coverage

✅ **All tests passing (100%)** - Production ready!

- ✅ **Webhook tests**: Subscription events, cancellation, customer deletion
- ✅ **Client plugin**: Type inference and plugin integration
- ✅ **Error codes**: All error codes properly exported
- ✅ **Type safety**: Full TypeScript type checking
- ✅ **Metadata helpers**: Customer metadata management
- ✅ **Core functionality**: Customer creation and subscription management

For detailed testing guide, see `HOW_TO_TEST.md` in the repository.

### Writing Tests

Example test for subscription upgrade:

```typescript
import { getTestInstance } from "better-auth/test";
import { chargebee } from "@better-auth/chargebee";
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
        customer: {
            list: vi.fn().mockResolvedValue({ list: [] }),
            create: vi.fn().mockResolvedValue({
                customer: { id: "cust_123" }
            }),
        },
    };

    const { auth, testUser } = await getTestInstance({
        plugins: [
            chargebee({
                chargebeeClient: mockChargebee as any,
                subscription: {
                    enabled: true,
                    plans: [
                        {
                            name: "Pro",
                            itemPriceId: "pro-plan",
                            type: "plan"
                        }
                    ],
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
        checkoutNewForItems: vi.fn().mockResolvedValue({
            hosted_page: { id: "hp_123", url: "https://test.chargebee.com" }
        }),
        checkoutExistingForItems: vi.fn(),
    },
    subscription: {
        cancel: vi.fn(),
        list: vi.fn().mockResolvedValue({ list: [] }),
    },
    portalSession: {
        create: vi.fn().mockResolvedValue({
            portal_session: { access_url: "https://portal.chargebee.com" }
        }),
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

## Differences from Stripe Plugin

While the Chargebee plugin follows a similar pattern to the Stripe plugin, there are some key differences:

| Feature | Chargebee | Stripe |
|---------|-----------|--------|
| **Billing Model** | Item-based (item price IDs) | Price-based (price IDs) |
| **Multi-item Subscriptions** | Native support for multiple items | Single product per subscription |
| **Checkout** | Hosted Pages | Checkout Sessions |
| **Webhook Authentication** | Basic Authentication | Signature verification |
| **Trial Management** | Configured at plan level + per checkout | Configured per subscription |
| **Subscription Status** | future, in_trial, active, non_renewing, paused, cancelled, transferred | incomplete, trialing, active, past_due, canceled, unpaid |
| **Plan Configuration** | Uses `itemPriceId` | Uses `priceId` |
| **Annual Billing** | Same item price structure | Separate `annualDiscountPriceId` |

### Migration from Stripe

If you're migrating from Stripe to Chargebee:

1. **Update plan definitions**: Replace `priceId` with `itemPriceId` and add `type: "plan"`
2. **Update checkout calls**: `upgradeSubscription` uses `itemPriceId` instead of `plan` parameter
3. **Update webhook handling**: Configure Basic Auth instead of signature verification
4. **Update status checks**: Use Chargebee status values in your application logic
5. **Database schema**: Run migrations to add Chargebee-specific fields

## Examples

For a complete working example with Next.js, see the [example implementation](https://github.com/chargebee/js-framework-adapters/tree/main/examples/next-chargebee-better-auth).

The example includes:
- Complete authentication setup
- Pricing page with plan selection
- Subscription management dashboard
- Webhook handling
- TypeScript throughout

## Support & Resources

- **Documentation**: [GitHub Repository](https://github.com/chargebee/js-framework-adapters/tree/main/packages/better-auth)
- **Report Issues**: [GitHub Issues](https://github.com/chargebee/js-framework-adapters/issues)
- **Chargebee Docs**: [Chargebee Documentation](https://www.chargebee.com/docs/)
- **Better Auth Docs**: [Better Auth Documentation](https://www.better-auth.com/)

## License

MIT
