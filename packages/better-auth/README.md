# Chargebee

Chargebee plugin for Better Auth to manage subscriptions and payments.

The Chargebee plugin integrates Chargebee's subscription management and billing functionality with Better Auth. Since payment and authentication are often tightly coupled, this plugin simplifies the integration of Chargebee into your application, handling customer creation, subscription management, and webhook processing.

## Features

- Create Chargebee customers automatically when users sign up
- Manage subscription plans and pricing (item-based: plans, addons, charges)
- Process subscription lifecycle events (creation, updates, cancellations)
- Handle Chargebee webhooks securely with Basic Auth verification
- Expose subscription data to your application
- Support for trial periods and multi-item subscriptions
- Flexible reference system to associate subscriptions with users or organizations
- Team subscription support with seats management
- Hosted checkout and portal via Chargebee Hosted Pages

## Installation

### Step 1: Install the plugin

First, install the plugin:

```bash
npm install @better-auth/chargebee
```

> **Note:** If you're using a separate client and server setup, make sure to install the plugin in both parts of your project.

### Step 2: Install the Chargebee SDK

Next, install the Chargebee SDK on your server:

```bash
npm install chargebee
```

### Step 3: Add the plugin to your auth config

```ts
import { betterAuth } from "better-auth"
import { chargebee } from "@better-auth/chargebee"
import Chargebee from "chargebee"

const chargebeeClient = new Chargebee()
chargebeeClient.configure({
    site: process.env.CHARGEBEE_SITE!,
    api_key: process.env.CHARGEBEE_API_KEY!,
})

// Optional: Fetch plans from Chargebee API
const plans = await chargebeeClient.itemPrice.list({
    item_type: { is: 'plan' },
})

const confPlans = plans.list.map((plan) => ({
    name: plan.item_price.name,
    itemPriceId: plan.item_price.id,
    type: 'plan' as const,
}))

export const auth = betterAuth({
    // ... your existing config
    plugins: [
        chargebee({
            chargebeeClient,
            webhookUsername: process.env.CHARGEBEE_WEBHOOK_USERNAME,
            webhookPassword: process.env.CHARGEBEE_WEBHOOK_PASSWORD,
            createCustomerOnSignUp: true,
            subscription: {
                enabled: true,
                plans: confPlans, // or define plans statically
            }
        })
    ]
})
```

### Step 4: Add the client plugin

```ts
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

### Step 5: Migrate the database

Run the migration or generate the schema to add the necessary tables to the database.

**Option A – migrate:**

```bash
npx @better-auth/cli migrate
```

**Option B – generate:**

```bash
npx @better-auth/cli generate
```

See the [Schema](#schema) section to add the tables manually.

> **Note:** The plugin works with any Better Auth adapter (Prisma, Drizzle, Kysely, etc.). The `npx @better-auth/cli generate` command will create the correct schema for your adapter. Ensure your database column names match the generated schema or follow your adapter's documentation for field name mapping.

### Step 6: Set up Chargebee webhooks

Create a webhook endpoint in your Chargebee dashboard pointing to:

```
https://your-domain.com/api/auth/chargebee/webhook
```

`/api/auth` is the default path for the auth server.

Make sure to select at least these events:

- `subscription_created`
- `subscription_activated`
- `subscription_changed`
- `subscription_renewed`
- `subscription_started`
- `subscription_cancelled`
- `subscription_cancellation_scheduled`
- `customer_deleted`

If you set `webhookUsername` and `webhookPassword`, configure the same Basic Authentication credentials in the Chargebee webhook settings.

## Usage

### Complete Setup Example

Here's a complete example showing how to set up the plugin with plans fetched from Chargebee:

```ts
import { betterAuth } from "better-auth"
import { chargebee } from "@better-auth/chargebee"
import Chargebee from "chargebee"

// Initialize Chargebee client
const chargebeeClient = new Chargebee()
chargebeeClient.configure({
    site: process.env.CHARGEBEE_SITE!,
    api_key: process.env.CHARGEBEE_API_KEY!,
})

// Fetch plans from Chargebee
const plansResponse = await chargebeeClient.itemPrice.list({
    item_type: { is: 'plan' },
    status: { is: 'active' },
})

const plans = plansResponse.list.map((item) => ({
    name: item.item_price.name,
    itemPriceId: item.item_price.id,
    type: 'plan' as const,
    limits: {
        // Map from Chargebee metadata or hardcode
        projects: item.item_price.metadata?.projects || 10,
        storage: item.item_price.metadata?.storage || 50,
    }
}))

export const auth = betterAuth({
    database: /* your adapter */,
    secret: process.env.BETTER_AUTH_SECRET!,
    plugins: [
        chargebee({
            chargebeeClient,
            createCustomerOnSignUp: true,
            webhookUsername: process.env.CHARGEBEE_WEBHOOK_USERNAME,
            webhookPassword: process.env.CHARGEBEE_WEBHOOK_PASSWORD,
            subscription: {
                enabled: true,
                plans,
                onSubscriptionCreated: async ({ subscription }) => {
                    console.log('New subscription:', subscription.id)
                    // Send welcome email, etc.
                },
            },
            onCustomerCreate: async ({ chargebeeCustomer, user }) => {
                console.log(`Customer ${chargebeeCustomer.id} created for user ${user.id}`)
            },
        })
    ]
})
```

### Customer Management

You can use this plugin solely for customer management without enabling subscriptions. This is useful if you just want to link Chargebee customers to your users.

When you set `createCustomerOnSignUp: true`, a Chargebee customer is automatically created on signup and linked to the user in your database. You can customize the customer creation process:

```ts
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

Chargebee uses an item-based billing model. You can define your subscription plans in three ways: statically, dynamically from your database, or by fetching directly from the Chargebee API.

**Option 1: Static plans**

```ts
subscription: {
    enabled: true,
    plans: [
        {
            name: "starter",
            itemPriceId: "starter-USD-Monthly",
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
```

**Option 2: Fetch from Chargebee API (Recommended)**

Fetch plans directly from Chargebee to keep them in sync with your Chargebee configuration:

```ts
// Fetch plans directly from Chargebee
const chargebeeClient = new Chargebee()
chargebeeClient.configure({
    site: process.env.CHARGEBEE_SITE!,
    api_key: process.env.CHARGEBEE_API_KEY!,
})

// Fetch all plans
const plans = await chargebeeClient.itemPrice.list({
    item_type: { is: 'plan' },
})

const confPlans = plans.list.map((plan) => ({
    name: plan.item_price.name,
    itemPriceId: plan.item_price.id,
    type: 'plan' as const,
}))

export const auth = betterAuth({
    // ... other config
    plugins: [
        chargebee({
            chargebeeClient,
            subscription: {
                enabled: true,
                plans: confPlans,
            }
        })
    ]
})
```

You can also filter or customize the plans:

```ts
// Fetch only active plans with a specific status
const plans = await chargebeeClient.itemPrice.list({
    item_type: { is: 'plan' },
    status: { is: 'active' },
})

const confPlans = plans.list.map((plan) => ({
    name: plan.item_price.name,
    itemPriceId: plan.item_price.id,
    type: 'plan' as const,
    // Add custom limits based on plan metadata
    limits: {
        projects: plan.item_price.metadata?.projects || 10,
        storage: plan.item_price.metadata?.storage || 50,
    },
    // Add free trial if configured in Chargebee
    freeTrial: plan.item_price.trial_period
        ? { days: plan.item_price.trial_period }
        : undefined,
}))
```

You can also fetch addons and charges:

```ts
// Fetch addons
const addons = await chargebeeClient.itemPrice.list({
    item_type: { is: 'addon' },
})

const confAddons = addons.list.map((addon) => ({
    name: addon.item_price.name,
    itemPriceId: addon.item_price.id,
    type: 'addon' as const,
}))

// Combine plans and addons
const allProducts = [...confPlans, ...confAddons]
```

**Option 3: Dynamic plans from database**

```ts
subscription: {
    enabled: true,
    plans: async () => {
        const plans = await db.query("SELECT * FROM plans");
        return plans.map(plan => ({
            name: plan.name,
            itemPriceId: plan.chargebee_item_price_id,
            type: "plan" as const,
            limits: plan.limits
        }));
    }
}
```

**Which option should you use?**

| Approach | Best for | Pros | Cons |
|----------|----------|------|------|
| **Static plans** | Small, unchanging catalogs | Simple, fast startup | Requires code changes to update |
| **Chargebee API** | Dynamic catalogs, multiple environments | Always in sync, no code changes needed | Adds startup time, requires API call |
| **Database** | Custom pricing logic, cached plans | Flexible, can cache API results | Requires custom sync logic |

> **Recommended:** Use the Chargebee API approach (Option 2) for most applications. It ensures your plans are always in sync with your Chargebee configuration without manual updates.

See [Plan configuration](#plan-configuration) for more details on plan options.

#### Creating a Subscription

To create a subscription, use the `subscription.upgrade` method:

**Endpoint:** `POST /subscription/upgrade` (requires session)

```ts
type upgradeSubscription = {
    /**
     * The item price ID(s) from Chargebee. Single string or array for multi-item subscriptions.
     */
    itemPriceId: string | string[]
    /**
     * The URL to which the user is sent when payment or setup is complete.
     */
    successUrl: string
    /**
     * If set, customers are directed here if they cancel.
     */
    cancelUrl: string
    /**
     * Reference id of the subscription. Defaults based on customerType.
     */
    referenceId?: string
    /**
     * The id of the subscription to upgrade.
     */
    subscriptionId?: string
    /**
     * Additional metadata to store with the subscription.
     */
    metadata?: Record<string, any>
    /**
     * The type of customer for billing. (Default: "user")
     */
    customerType?: "user" | "organization"
    /**
     * Number of seats (if applicable).
     */
    seats?: number
    /**
     * The URL to return to from the portal (used when upgrading).
     */
    returnUrl?: string
    /**
     * Disable redirect after successful subscription.
     */
    disableRedirect?: boolean
    /**
     * Unix timestamp for when the trial should end.
     */
    trialEnd?: number
}
```

**Simple example:**

```ts
await authClient.subscription.upgrade({
    itemPriceId: "pro-USD-Monthly",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
    referenceId: "org_123", // Optional: defaults based on customerType
    seats: 5, // Optional: for team plans
});
```

This creates a Chargebee Hosted Page and redirects the user to the Chargebee checkout page.

> **Note:** The plugin supports one active or trialing subscription per reference ID (user or organization) at a time. Multiple concurrent subscriptions for the same reference ID are not supported.
>
> If the user already has an active subscription, you **must** provide the `subscriptionId` parameter when upgrading. Otherwise, a new subscription may be created alongside the existing one, resulting in duplicate billing.

> **Important:** The `successUrl` parameter is internally modified to handle race conditions between checkout completion and webhook processing. The plugin uses an intermediate redirect so subscription status is updated before redirecting to your success page.

```ts
const { error } = await authClient.subscription.upgrade({
    itemPriceId: "pro-USD-Monthly",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
});
if (error) {
    alert(error.message);
}
```

#### Multi-Item Subscriptions

Chargebee supports multiple items in a single subscription (plans, addons, charges):

```ts
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

To switch a subscription to a different plan, use `subscription.upgrade` with the current subscription ID:

```ts
await authClient.subscription.upgrade({
    itemPriceId: "enterprise-USD-Monthly",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
    subscriptionId: "sub_123", // the Chargebee subscription ID of the user's current plan
});
```

This ensures the user is charged only for the new plan.

#### Listing Active Subscriptions

Subscription data is stored in your database. Query it with your adapter or ORM by `referenceId` (user ID or organization ID). For example:

```ts
// Using Better Auth adapter
const subscriptions = await ctx.adapter.findMany({
    model: "subscription",
    where: [{ field: "referenceId", value: session.user.id }]
});

const activeSubscription = subscriptions.find(
    sub => sub.status === "active" || sub.status === "in_trial"
);

// Check subscription limits
const projectLimit = activeSubscription?.limits?.projects || 0;
```

Implement `authorizeReference` when listing subscriptions for a reference (e.g. organization) so only authorized users can see them:

```ts
chargebee({
    // ... other options
    subscription: {
        // ... other subscription options
        authorizeReference: async ({ user, session, referenceId, action }) => {
            if (action === "list-subscription") {
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
})
```

#### Canceling a Subscription

To cancel a subscription:

**Endpoint:** `POST /subscription/cancel` (requires session)

```ts
type cancelSubscription = {
    /**
     * Reference id of the subscription to cancel. Defaults based on customerType.
     */
    referenceId?: string
    /**
     * The type of customer for billing. (Default: "user")
     */
    customerType?: "user" | "organization"
    /**
     * The id of the subscription to cancel.
     */
    subscriptionId?: string
    /**
     * URL to take customers to when they return from the portal.
     */
    returnUrl: string
    /**
     * Disable redirect after cancellation.
     */
    disableRedirect?: boolean
}
```

This redirects the user to the Chargebee Portal where they can cancel their subscription.

> **Note:** Chargebee supports different cancellation behaviors; the plugin tracks them:
>
> | Field        | Description                                                       |
> | ------------ | ----------------------------------------------------------------- |
> | `canceledAt` | When the subscription was canceled.                               |
> | `status`     | Becomes `"cancelled"` when the subscription has ended.             |

### Reference System

By default, subscriptions are tied to the user ID. You can use a custom reference ID to tie them to other entities (e.g. organizations):

```ts
// Create a subscription for an organization
await authClient.subscription.upgrade({
    itemPriceId: "team-plan-USD-Monthly",
    referenceId: "org_123456",
    customerType: "organization",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
    seats: 5
});

// List subscriptions for an organization (query your DB by referenceId)
const { data: subscriptions } = await yourApi.getSubscriptions({ referenceId: "org_123456" });
```

#### Team Subscriptions with Seats

For team or organization plans, you can set the number of seats:

```ts
await authClient.subscription.upgrade({
    itemPriceId: "team-USD-Monthly",
    referenceId: "org_123456",
    customerType: "organization",
    seats: 10,
    successUrl: "/org/billing/success",
    cancelUrl: "/org/billing"
});
```

The `seats` value is sent to Chargebee as the quantity for the subscription item. Use it in your app to limit team or organization size.

To authorize reference IDs, implement `authorizeReference`:

```ts
subscription: {
    // ... other options
    authorizeReference: async ({ user, session, referenceId, action }) => {
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

The plugin handles these webhook events:

- `subscription_created`: Creates a subscription when created
- `subscription_activated`: Updates subscription when activated
- `subscription_changed`: Updates subscription when changed
- `subscription_renewed`: Updates on renewal
- `subscription_started`: Updates when trial ends and subscription starts
- `subscription_cancelled`: Marks subscription as canceled
- `subscription_cancellation_scheduled`: Updates with scheduled cancellation
- `customer_deleted`: Cleans up customer and related subscriptions

You can also handle custom events:

```ts
chargebee({
    // ... other options
    onEvent: async (event) => {
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

You can hook into subscription lifecycle events:

```ts
subscription: {
    // ... other options
    onSubscriptionComplete: async ({ subscription, chargebeeSubscription }) => {
        // When a subscription is completed via hosted page
        await sendWelcomeEmail(subscription.referenceId);
    },
    onSubscriptionCreated: async ({ subscription, chargebeeSubscription }) => {
        // When a subscription is created
        await sendSubscriptionCreatedEmail(subscription.referenceId);
    },
    onSubscriptionUpdate: async ({ subscription }) => {
        console.log(`Subscription ${subscription.id} updated`);
    },
    onSubscriptionDeleted: async ({ subscription, chargebeeSubscription }) => {
        await sendCancellationEmail(subscription.referenceId);
    },
    onTrialStart: async ({ subscription }) => {
        await sendTrialStartEmail(subscription.referenceId);
    },
    onTrialEnd: async ({ subscription }) => {
        await sendTrialEndEmail(subscription.referenceId);
    }
}
```

### Trial Periods

Configure trial periods on your plans:

```ts
{
    name: "pro",
    itemPriceId: "pro-USD-Monthly",
    type: "plan",
    freeTrial: {
        days: 14,
    }
}
```

To set a custom trial end date, pass `trialEnd` (Unix timestamp) when upgrading:

```ts
await authClient.subscription.upgrade({
    itemPriceId: "pro-USD-Monthly",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
    trialEnd: 1735689600, // e.g. Jan 1, 2025
});
```

## Schema

The Chargebee plugin adds the following tables to your database.

### User

**Table name:** `user`

| Field                 | Type     | Description                | Optional |
| --------------------- | -------- | -------------------------- | -------- |
| `chargebeeCustomerId` | `string` | The Chargebee customer ID | Yes      |

### Organization

**Table name:** `organization` *(only when `organization.enabled` is `true`)*

| Field                 | Type     | Description                              | Optional |
| --------------------- | -------- | ---------------------------------------- | -------- |
| `chargebeeCustomerId` | `string` | The Chargebee customer ID for the org    | Yes      |

### Subscription

**Table name:** `subscription`

| Field                    | Type     | Description                                                                 | Optional | Default   |
| ------------------------ | -------- | --------------------------------------------------------------------------- | -------- | --------- |
| `id`                     | `string` | Unique identifier for each subscription                                     | No       | -         |
| `plan`                   | `string` | Plan name (if single plan) or derived from items                            | Yes      | -         |
| `referenceId`            | `string` | ID this subscription is associated with (user ID by default). Not unique.   | No       | -         |
| `chargebeeCustomerId`    | `string` | The Chargebee customer ID                                                  | Yes      | -         |
| `chargebeeSubscriptionId`| `string` | The Chargebee subscription ID                                              | Yes      | -         |
| `status`                 | `string` | Subscription status (future, in_trial, active, non_renewing, paused, cancelled, transferred) | Yes | "future"  |
| `periodStart`            | `Date`   | Start of the current billing period                                         | Yes      | -         |
| `periodEnd`              | `Date`   | End of the current billing period                                           | Yes      | -         |
| `trialStart`             | `Date`   | Trial start                                                                 | Yes      | -         |
| `trialEnd`                | `Date`   | Trial end                                                                  | Yes      | -         |
| `canceledAt`             | `Date`   | When the subscription was canceled                                          | Yes      | -         |
| `seats`                  | `number` | Number of seats for team plans                                              | Yes      | -         |
| `metadata`               | `string` | JSON string of additional metadata                                          | Yes      | -         |

### Subscription Item

**Table name:** `subscriptionItem`

| Field            | Type     | Description                    | Optional |
| ---------------- | -------- | ------------------------------ | -------- |
| `id`             | `string` | Unique identifier              | No       |
| `subscriptionId` | `string` | Foreign key to subscription    | No       |
| `itemPriceId`    | `string` | Chargebee item price ID        | No       |
| `itemType`       | `string` | Type: plan, addon, or charge   | No       |
| `quantity`       | `number` | Quantity of this item          | No       |
| `unitPrice`      | `number` | Unit price                     | Yes      |
| `amount`         | `number` | Total amount for this item     | Yes      |

### Customizing the Schema

To change table or field names, pass a `schema` option to the Chargebee plugin (if supported by the plugin API). Otherwise, rely on the default schema and use your adapter’s mapping.

## Options

| Option                   | Type       | Description                                                                 |
| ------------------------ | ---------- | --------------------------------------------------------------------------- |
| `chargebeeClient`        | `Chargebee`| The Chargebee client instance. **Required.**                                |
| `webhookUsername`        | `string`   | Username for Basic Auth on the webhook endpoint. Recommended in production. |
| `webhookPassword`        | `string`   | Password for Basic Auth on the webhook endpoint. Recommended in production. |
| `createCustomerOnSignUp` | `boolean`  | Create a Chargebee customer when a user signs up. Default: `false`.         |
| `onCustomerCreate`       | `function` | Callback after a customer is created. Receives `{ chargebeeCustomer, user }`. |
| `onEvent`                | `function` | Callback for any Chargebee webhook event. Receives the event object.        |
| `subscription`           | `object`   | Subscription configuration. See [Subscription options](#subscription-options). |
| `organization`           | `object`   | Organization customer support. See [Organization options](#organization-options). |

### Subscription Options

| Option                    | Type                         | Description                                                                 |
| ------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| `enabled`                 | `boolean`                    | Enable subscription functionality. **Required.**                             |
| `plans`                   | `ChargebeePlan[]` or `function` | Array of plans or async function returning plans. **Required** if enabled.  |
| `requireEmailVerification`| `boolean`                    | Require verified email before upgrade. Default: `false`.                    |
| `authorizeReference`      | `function`                   | Authorize reference IDs. Receives `{ user, session, referenceId, action }`.  |
| `getHostedPageParams`     | `function`                   | Customize Hosted Page params. Receives `{ user, session, plan, subscription }`, request, context. |
| `onSubscriptionComplete`  | `function`                   | When subscription is completed via hosted page. Receives `{ subscription, chargebeeSubscription }`. |
| `onSubscriptionCreated`  | `function`                   | When subscription is created. Receives `{ subscription, chargebeeSubscription }`. |
| `onSubscriptionUpdate`   | `function`                   | When subscription is updated. Receives `{ subscription }`.                  |
| `onSubscriptionDeleted`  | `function`                   | When subscription is deleted. Receives `{ subscription, chargebeeSubscription }`. |
| `onTrialStart`            | `function`                   | When a trial starts. Receives `{ subscription }`.                           |
| `onTrialEnd`              | `function`                   | When a trial ends. Receives `{ subscription }`.                              |

#### Plan configuration

| Option          | Type     | Description                                           |
| --------------- | -------- | ----------------------------------------------------- |
| `name`          | `string` | Plan name. **Required.**                              |
| `itemPriceId`   | `string` | Chargebee item price ID. **Required.**                |
| `itemId`        | `string` | Chargebee item ID. Optional.                          |
| `itemFamilyId`  | `string` | Chargebee item family ID. Optional.                   |
| `type`          | `string` | `"plan"` \| `"addon"` \| `"charges"`. **Required.**   |
| `limits`        | `object` | Limits (e.g. `{ projects: 10, storage: 5 }`).         |
| `freeTrial`     | `object` | Free trial config: `{ days: number }`.                |
| `trialPeriod`   | `number` | Trial period length. Optional.                         |
| `trialPeriodUnit` | `string` | `"day"` \| `"month"`. Optional.                    |
| `billingCycles` | `number` | Number of billing cycles. Optional.                   |

#### Free trial configuration

| Option   | Type       | Description                                    |
| -------- | ---------- | ---------------------------------------------- |
| `days`   | `number`   | Number of trial days. **Required.**            |

### Organization Options

| Option                    | Type       | Description                                                                 |
| ------------------------- | ---------- | --------------------------------------------------------------------------- |
| `enabled`                 | `boolean`  | Enable organization as customer. **Required.**                              |
| `getCustomerCreateParams` | `function` | Customize customer creation for organizations. Receives `organization`, context. |
| `onCustomerCreate`        | `function` | After organization customer is created. Receives `{ chargebeeCustomer, organization }`, context. |

## Advanced Usage

### Using with Organizations

The Chargebee plugin works with the [organization plugin](https://www.better-auth.com/docs/plugins/organization) so organizations can be the billing entity. Subscriptions are then tied to the organization instead of individual users.

> **When Organization Customer is enabled:**
>
> - A Chargebee customer is created when an organization first subscribes
> - Organization name changes can be synced to the Chargebee customer
> - Organizations with active subscriptions typically cannot be deleted (enforce in your app if needed)

#### Enabling Organization Customer

Set `organization.enabled` to `true` and ensure the organization plugin is installed:

```ts
plugins: [
    organization(),
    chargebee({
        // ... other options
        subscription: {
            enabled: true,
            plans: [...],
        },
        organization: {
            enabled: true
        }
    })
]
```

#### Creating Organization Subscriptions

With Organization Customer enabled, pass `customerType: "organization"` and the organization ID as `referenceId`:

```ts
await authClient.subscription.upgrade({
    itemPriceId: "team-USD-Monthly",
    referenceId: activeOrg.id,
    customerType: "organization",
    seats: 10,
    successUrl: "/org/billing/success",
    cancelUrl: "/org/billing"
});
```

#### Authorization

Implement `authorizeReference` so only allowed users can manage organization subscriptions:

```ts
subscription: {
    // ... other options
    authorizeReference: async ({ user, referenceId, action }) => {
        const member = await db.member.findFirst({
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

You can customize the Chargebee Hosted Page:

```ts
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

The plugin can expose typed error codes for handling failures:

```ts
import { CHARGEBEE_ERROR_CODES } from "@better-auth/chargebee";

// Examples
CHARGEBEE_ERROR_CODES.ALREADY_SUBSCRIBED
CHARGEBEE_ERROR_CODES.SUBSCRIPTION_NOT_FOUND
CHARGEBEE_ERROR_CODES.PLAN_NOT_FOUND
CHARGEBEE_ERROR_CODES.CUSTOMER_NOT_FOUND
CHARGEBEE_ERROR_CODES.UNAUTHORIZED_REFERENCE
CHARGEBEE_ERROR_CODES.EMAIL_VERIFICATION_REQUIRED
// ... see package for full list
```

Use these in your API or client to show appropriate messages or redirects.

## Troubleshooting

### Column/field naming errors

If you see errors like `no such column: "chargebee_customer_id"` or `no such column: "chargebeeCustomerId"`:

**Cause:** Mismatch between your database column names and your adapter's schema definition.

**Solution:**

1. Run `npx @better-auth/cli generate` to regenerate your schema with the Chargebee plugin fields
2. Apply the migration to your database
3. If manually migrating from another adapter, ensure your column names match your database adapter's conventions
4. Refer to the [Better Auth adapter documentation](https://www.better-auth.com/docs/concepts/database) for field name mapping specific to your adapter (Prisma, Drizzle, Kysely, etc.)

### Webhook issues

If webhooks are not processed correctly:

1. Confirm the webhook URL in the Chargebee dashboard matches your auth base path (e.g. `https://your-domain.com/api/auth/chargebee/webhook`).
2. Ensure `webhookUsername` and `webhookPassword` match the Basic Auth settings in Chargebee.
3. Confirm all required events are selected in Chargebee.
4. Check server logs for errors during webhook handling and for 401s if Basic Auth is used.

### Subscription status issues

If subscription status does not update:

1. Verify webhook events are received and processed (logs).
2. Check that `chargebeeCustomerId` and `chargebeeSubscriptionId` are set on the subscription record.
3. Ensure `referenceId` in your DB matches what you use in the app and in Chargebee.
4. Confirm your database schema matches the plugin’s expected tables and columns.

### Testing webhooks locally

Use a tunnel (e.g. ngrok) to expose your local server and register a webhook in Chargebee pointing to `https://your-ngrok-url/api/auth/chargebee/webhook`. Use the same Basic Auth credentials in Chargebee and in your local env. Prefer a non-primary webhook for local testing.

## Resources

- [Chargebee Documentation](https://www.chargebee.com/docs/)
- [Better Auth Documentation](https://www.better-auth.com/)
- [Example: Next.js + Chargebee + Better Auth](https://github.com/chargebee/js-framework-adapters/tree/main/examples/next-chargebee-better-auth)
