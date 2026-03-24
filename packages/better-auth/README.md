# Chargebee

Chargebee plugin for Better Auth to manage subscriptions and payments.

The Chargebee plugin integrates [Chargebee's](https://www.chargebee.com) subscription management and billing functionality with Better Auth. Since payment and authentication are often tightly coupled, this plugin simplifies the integration of Chargebee into your application, handling customer creation, subscription management, and webhook processing.

## Features

- Create Chargebee customers automatically when users sign up
- Manage subscription plans and pricing (item-based: plans, addons, charges)
- Process subscription lifecycle events (creation, updates, cancellations)
- Handle Chargebee webhooks securely with Basic Auth verification
- Expose subscription data to your application
- Support for trial periods and multi-item subscriptions
- Automatic trial abuse prevention - Users can only get one trial per account across all plans
- Flexible reference system to associate subscriptions with users or organizations
- Team subscription support with seats management
- Hosted checkout and portal via Chargebee Hosted Pages
- Self-service billing portal for managing payment methods, invoices, and subscriptions

## Requirements

- **Node.js** `>=22.0.0`

## Installation

### Step 1: Install the plugin

First, install the plugin:

```bash
npm install @chargebee/better-auth
# or
yarn add @chargebee/better-auth
# or
pnpm add @chargebee/better-auth
```

> **Note:** If you're using a separate client and server setup, make sure to install the plugin in both parts of your project.

### Step 2: Install the Chargebee SDK

Next, install the Chargebee SDK on your server:

```bash
npm install chargebee
# or
yarn add chargebee
# or
pnpm add chargebee
```

### Step 3: Add the plugin to your auth config

```ts
import { betterAuth } from "better-auth"
import { chargebee } from "@chargebee/better-auth"
import Chargebee from "chargebee"

const chargebeeClient = new Chargebee({
    apiKey: process.env.CHARGEBEE_API_KEY!,
    site: process.env.CHARGEBEE_SITE!,
})

export const auth = betterAuth({
    // ... your existing config
    plugins: [
        chargebee({
            chargebeeClient,
            createCustomerOnSignUp: true,
            webhookUsername: process.env.CHARGEBEE_WEBHOOK_USERNAME,
            webhookPassword: process.env.CHARGEBEE_WEBHOOK_PASSWORD,
        })
    ]
})
```

### Step 4: Add the client plugin

```ts
import { createAuthClient } from "better-auth/client"
import { chargebeeClient } from "@chargebee/better-auth/client"

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
npx auth migrate
```

**Option B – generate:**

```bash
npx auth generate
```

See the [Schema](#schema) section to add the tables manually.

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

#### Passing Additional Customer Params

Better Auth stores names in a single `user.name` field. If you want to pass `first_name`, `last_name`, or any other Chargebee customer field, use `getCustomerCreateParams`:

```ts
chargebee({
    // ... other options
    createCustomerOnSignUp: true,
    getCustomerCreateParams: (user) => {
        const [firstName, ...rest] = (user.name ?? "").split(" ");
        return {
            first_name: firstName,
            last_name: rest.join(" ") || undefined,
            // any other Chargebee Customer.CreateInputParam fields
        };
    },
})
```

The callback receives the `user` object and an optional `ctx` (request context, available when the customer is created on-demand at subscription time rather than during sign-up).

### Subscription Management

#### Defining Plans

Chargebee uses an item-based billing model. You can define your subscription plans either statically or dynamically:

**Static plans:**

```ts
subscription: {
    enabled: true,
    plans: [
        {
            name: "starter", // automatically lowercased when stored in the database
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
```

**Dynamic plans from database (Recommended):**

Fetching plans from your own database is the recommended approach. It gives you full control over plan data, lets you enrich plans with custom metadata (limits, features, display info), and avoids hard-coding Chargebee configuration into your auth setup:

```ts
subscription: {
    enabled: true,
    plans: async () => {
        const plans = await db.query("SELECT * FROM plans");
        return plans.map(plan => ({
            name: plan.name,
            itemPriceId: plan.chargebee_item_price_id,
            type: "plan" as const,
            limits: JSON.parse(plan.limits)
        }));
    }
}
```

See [Plan configuration](#plan-configuration) for more details on plan options.

#### Creating a Subscription

To create a new subscription, use the `subscription.create` method:

**Endpoint:** `POST /subscription/create` (requires session)

```ts
type createSubscription = {
    /**
     * The item price ID(s) from Chargebee. Single string or array for multi-item subscriptions.
     */
    itemPriceId: string | string[]
    /**
     * Reference id of the subscription. Defaults based on customerType.
     */
    referenceId?: string
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
     * The URL to which the user is sent when payment or setup is complete.
     */
    successUrl: string
    /**
     * If set, customers are directed here if they cancel.
     */
    cancelUrl: string
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
await authClient.subscription.create({
    itemPriceId: "pro-USD-Monthly",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
    referenceId: "org_123", // Optional: defaults based on customerType
    seats: 5, // Optional: for team plans
});
```

This creates a Chargebee Hosted Page and redirects the user to the Chargebee checkout page.

```ts
const { error } = await authClient.subscription.create({
    itemPriceId: "pro-USD-Monthly",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
});
if (error) {
    alert(error.message);
}
```

> **How the checkout redirect works:** The plugin does not redirect straight to your `successUrl`. Instead, Chargebee's `redirect_url` is set to the plugin's internally registered `GET /subscription/success` endpoint, which immediately forwards the user to your original `successUrl`. This gives the plugin a hook point between Chargebee's hosted-page redirect and your application.

#### Switching Plans

To switch an existing subscription to a different plan, use the `subscription.update` method. This ensures the user only pays for the new plan:

**Endpoint:** `POST /subscription/update` (requires session)

```ts
type updateSubscription = {
    /**
     * The item price ID(s) from Chargebee. Single string or array for multi-item subscriptions.
     */
    itemPriceId: string | string[]
    /**
     * Reference id of the subscription. Defaults based on customerType.
     */
    referenceId?: string
    /**
     * The id of the subscription to update.
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
     * Number of seats to update to (if applicable).
     */
    seats?: number
    /**
     * The URL to which the user is sent when payment or setup is complete.
     */
    successUrl: string
    /**
     * If set, customers are directed here if they cancel.
     */
    cancelUrl: string
    /**
     * The URL to return to from the portal.
     */
    returnUrl?: string
    /**
     * Disable redirect after successful update.
     */
    disableRedirect?: boolean
}
```

```ts
await authClient.subscription.update({
    itemPriceId: "enterprise-USD-Monthly", // new item price id
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
});
```

> **Note:** The plugin only supports one active or trialing subscription per reference ID (user or organization) at a time. Use `subscription.update` when the user already has an active subscription and wants to switch plans. Use `subscription.create` when the user has no active subscription.
>
> If the user already has an active subscription, you **must** use `subscription.update`. Attempting to create a new subscription via `subscription.create` will fail with an `ALREADY_SUBSCRIBED` error.

#### Listing Active Subscriptions

To retrieve the active subscriptions for the current user or organization, use the `subscription.list` method:

**Endpoint:** `GET /subscription/list` (requires session)

```ts
type listActiveSubscriptions = {
    /**
     * Reference id of the subscription. Defaults based on customerType.
     */
    referenceId?: string
    /**
     * The type of customer for billing. (Default: "user")
     */
    customerType?: "user" | "organization"
}
```

```ts
const { data } = await authClient.subscription.list();
// data → array of active/trialing subscriptions enriched with plan limits and itemPriceId

// For an organization:
const { data: orgSubscriptions } = await authClient.subscription.list({
    query: {
        referenceId: "org_123",
        customerType: "organization"
    }
});
```

#### Canceling a Subscription

To cancel a subscription, use the `subscription.cancel` method. This redirects the user to the Chargebee Portal where they can cancel their subscription. When a subscription is canceled at the end of the current billing period, Chargebee marks it as `non_renewing`. The status changes to `cancelled` only when the period ends.

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
     * URL to take customers to when they click the billing portal's link to return to your website.
     */
    returnUrl: string
}
```

```ts
await authClient.subscription.cancel({
    returnUrl: `${window.location.origin}/pricing?cancelled=true`,
})
```

> **Note:** Chargebee supports different cancellation behaviors; the plugin tracks them:
>
> | Field        | Description                                                       |
> | ------------ | ----------------------------------------------------------------- |
> | `canceledAt` | The time when the subscription was canceled.                      |
> | `status`     | Changes to `"cancelled"` when the subscription has ended.         |

#### Billing Portal Session

For a complete self-service billing experience, you can open the Chargebee customer portal where users can manage all aspects of their billing:

**Endpoint:** `POST /subscription/portal` (requires session)

```ts
type createPortalSession = {
    /**
     * Reference id of the customer. Defaults based on customerType.
     */
    referenceId?: string
    /**
     * The type of customer for billing. (Default: "user")
     */
    customerType?: "user" | "organization"
    /**
     * URL to redirect customers to after they complete their portal session.
     */
    returnUrl: string
    /**
     * Disable redirect after opening portal.
     */
    disableRedirect?: boolean
}
```

```ts
await authClient.subscription.portal({
    returnUrl: "/account/billing",
    fetchOptions: {
        onSuccess: (ctx) => {
            window.location.href = ctx.data.url;
        }
    }
});
```

For organization billing:

```ts
await authClient.subscription.portal({
    referenceId: "org_123456",
    customerType: "organization",
    returnUrl: "/org/billing"
});
```

The portal allows users to:
- Update payment methods (credit cards, bank accounts)
- View and download invoices
- Manage subscriptions (upgrade, downgrade, cancel)
- Update billing address and contact information
- View subscription history
- Apply promotional codes

> **Note:** The portal session provides a complete self-service experience and is recommended over individual operations like cancellation when you want to give users full control over their billing.

### Reference System

By default, subscriptions are associated with the user ID. However, you can use a custom reference ID to associate subscriptions with other entities, such as organizations:

```ts
// Create a subscription for an organization
await authClient.subscription.create({
    itemPriceId: "team-USD-Monthly",
    referenceId: "org_123456",
    customerType: "organization",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
    seats: 10 // Number of seats for team plans
});

// List subscriptions for an organization
const { data: subscriptions } = await authClient.subscription.list({
    query: {
        referenceId: "org_123456",
        customerType: "organization"
    }
});
```

#### Team Subscriptions with Seats

For team or organization plans, you can specify the number of seats:

```ts
await authClient.subscription.create({
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

```ts
subscription: {
    // ... other options
    authorizeReference: async ({ user, session, referenceId, action }) => {
        if (action === "create-subscription" || action === "update-subscription" || action === "cancel-subscription" || action === "billing-portal") {
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

#### Cancel Organization Subscription

```ts
await authClient.subscription.cancel({
    referenceId: "org_123456",
    customerType: "organization",
    returnUrl: "/organizations/org_123456"
});
```

### Webhook Handling

The plugin automatically processes common webhook events from Chargebee:

- **`subscription_created`** – Creates a subscription when it is created in Chargebee.
- **`subscription_activated`** – Updates the subscription when it becomes active.
- **`subscription_changed`** – Updates the subscription when changes are made.
- **`subscription_renewed`** – Updates the subscription upon renewal.
- **`subscription_started`** – Updates the subscription when the trial ends and the subscription starts.
- **`subscription_cancelled`** – Marks the subscription as canceled.
- **`subscription_cancellation_scheduled`** – Updates the subscription with the scheduled cancellation details.
- **`customer_deleted`** – Removes the customer and any associated subscriptions.

You can also handle custom events using `webhookHandler`, which gives you direct access to the typed handler instance:

```ts
import { WebhookEventType, WebhookHandler } from "chargebee"

chargebee({
    chargebeeClient,
    createCustomerOnSignUp: true,
    webhookHandler: (handler: WebhookHandler) => {
        handler.on(WebhookEventType.PaymentFailed, async ({ event }) => {
            // Handle failed payment
        });
        handler.on(WebhookEventType.InvoiceGenerated, async ({ event }) => {
            // Handle generated invoice
        });
    }
})
```

### Subscription Lifecycle Hooks

You can hook into various subscription lifecycle events:

```ts
subscription: {
    // ... other options
    onSubscriptionComplete: async ({ subscription, chargebeeSubscription, plan }) => {
        // Called when a subscription is successfully created via hosted page
        await sendWelcomeEmail(subscription.referenceId, plan.name);
    },
    onSubscriptionCreated: async ({ subscription, chargebeeSubscription, plan }) => {
        // Called when a subscription is created
        await sendSubscriptionCreatedEmail(subscription.referenceId, plan.name);
    },
    onSubscriptionUpdate: async ({ subscription }) => {
        // Called when a subscription is updated
        console.log(`Subscription ${subscription.id} updated`);
    },
    onSubscriptionDeleted: async ({ subscription, chargebeeSubscription }) => {
        // Called when a subscription is deleted
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

Configure trial periods on your plans:

```ts
{
    name: "pro",
    itemPriceId: "pro-USD-Monthly",
    type: "plan",
    freeTrial: {
        days: 14,  // 14-day trial automatically applied
    },
    limits: {
        projects: 100,
        storage: 500,
    }
}
```

When a user subscribes to this plan, **the trial is automatically applied** — no need to pass `trialEnd` manually:

```ts
// Trial is automatically calculated and applied based on plan config
await authClient.subscription.create({
    itemPriceId: "pro-USD-Monthly",  // Plan with 14-day trial
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
});
// ✅ User gets 14-day trial automatically!
```

The plugin calculates the trial end date as: **current date + trial days**.

#### Prevent Duplicate Trials

To prevent users from getting multiple trials, enable `preventDuplicateTrials`:

```ts
subscription: {
    enabled: true,
    plans,
    preventDuplicateTrials: true,  // Users can only get one trial
}
```

#### Override Trial End Date (Optional)

To set a custom trial end date, pass `trialEnd` (Unix timestamp):

```ts
await authClient.subscription.create({
    itemPriceId: "pro-USD-Monthly",
    successUrl: "/dashboard",
    cancelUrl: "/pricing",
    trialEnd: 1735689600,  // Custom trial end: Jan 1, 2025
});
```

> **Note:** Trials only work for **new subscriptions**. Updates to existing subscriptions cannot have trials (Chargebee limitation).

## Schema

The Chargebee plugin adds the following tables to your database.

### User

**Table name:** `user`

| Field                 | Type     | Description                | Optional |
| --------------------- | -------- | -------------------------- | -------- |
| `chargebeeCustomerId` | `string` | The Chargebee customer ID  | Yes      |

### Organization

**Table name:** `organization` *(only when `organization.enabled` is `true`)*

| Field                 | Type     | Description                              | Optional |
| --------------------- | -------- | ---------------------------------------- | -------- |
| `chargebeeCustomerId` | `string` | The Chargebee customer ID for the org    | Yes      |

### Subscription

**Table name:** `subscription`

| Field                     | Type     | Description                                                                                                                       | Optional | Default   |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- | -------- | --------- |
| `id`                      | `string` | Unique identifier for each subscription                                                                                           | No       | -         |
| `referenceId`             | `string` | The ID this subscription is associated with (user ID by default). Should NOT be unique — allows users to resubscribe after cancellation. | No  | -         |
| `chargebeeCustomerId`     | `string` | The Chargebee customer ID                                                                                                         | Yes      | -         |
| `chargebeeSubscriptionId` | `string` | The Chargebee subscription ID                                                                                                     | Yes      | -         |
| `status`                  | `string` | Subscription status (future, in_trial, active, non_renewing, paused, cancelled, transferred)                                      | Yes      | "future"  |
| `periodStart`             | `Date`   | Start date of the current billing period                                                                                          | Yes      | -         |
| `periodEnd`               | `Date`   | End date of the current billing period                                                                                            | Yes      | -         |
| `trialStart`              | `Date`   | Start date of the trial period                                                                                                    | Yes      | -         |
| `trialEnd`                | `Date`   | End date of the trial period                                                                                                      | Yes      | -         |
| `canceledAt`              | `Date`   | If the subscription has been canceled, this is the time when it was canceled                                                      | Yes      | -         |
| `seats`                   | `number` | Number of seats for team plans                                                                                                    | Yes      | -         |
| `metadata`                | `string` | JSON string of additional metadata                                                                                                | Yes      | -         |

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

To change the schema table names or fields, pass a `schema` option to the Chargebee plugin:

```ts
chargebee({
    // ... other options
    schema: {
        subscription: {
            modelName: "chargebeeSubscriptions", // map the subscription table to chargebeeSubscriptions
            fields: {
                referenceId: "userId" // map the referenceId field to userId
            }
        }
    }
})
```

## Options

| Option                   | Type       | Description                                                                                   |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------------- |
| `chargebeeClient`        | `Chargebee`| The Chargebee client instance. **Required.**                                                  |
| `webhookUsername`        | `string`   | Username for Basic Auth on the webhook endpoint. Recommended in production.                   |
| `webhookPassword`        | `string`   | Password for Basic Auth on the webhook endpoint. Recommended in production.                   |
| `createCustomerOnSignUp` | `boolean`  | Whether to automatically create a Chargebee customer when a user signs up. Default: `false`.  |
| `getCustomerCreateParams`| `function` | Return additional params for `cb.customer.create` (e.g. `first_name`, `last_name`). Receives `user` and optional `ctx`. |
| `onCustomerCreate`       | `function` | Callback called after a customer is created. Receives `{ chargebeeCustomer, user }`.          |
| `webhookHandler`         | `function` | Callback receiving the webhook handler instance. Call `handler.on(EventType, fn)` to register typed event listeners. |
| `subscription`           | `object`   | Subscription configuration. See [Subscription options](#subscription-options).                |
| `organization`           | `object`   | Enable Organization Customer support. See [Organization options](#organization-options).      |

### Subscription Options

| Option                    | Type                         | Description                                                                                                            |
| ------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `enabled`                 | `boolean`                    | Whether to enable subscription functionality. **Required.**                                                            |
| `plans`                   | `ChargebeePlan[]` or `function` | An array of subscription plans or an async function that returns plans. **Required** if enabled.                    |
| `requireEmailVerification`| `boolean`                    | Whether to require email verification before allowing subscription creation. Default: `false`.                         |
| `preventDuplicateTrials`  | `boolean`                    | Prevent users from getting multiple trials. Default: `false`.                                                          |
| `authorizeReference`      | `function`                   | Authorize reference IDs. Receives `{ user, session, referenceId, action }` and context.                                |
| `getHostedPageParams`     | `function`                   | Customize Chargebee Hosted Page parameters. Receives `{ user, session, plan, subscription }`, request, and context.   |
| `onSubscriptionComplete`  | `function`                   | Called when a subscription is created via hosted page. Receives `{ subscription, chargebeeSubscription, plan }`.       |
| `onSubscriptionCreated`   | `function`                   | Called when a subscription is created. Receives `{ subscription, chargebeeSubscription, plan }`.                       |
| `onSubscriptionUpdate`    | `function`                   | Called when a subscription is updated. Receives `{ subscription }`.                                                    |
| `onSubscriptionDeleted`   | `function`                   | Called when a subscription is deleted. Receives `{ subscription, chargebeeSubscription }`.                             |
| `onTrialStart`            | `function`                   | Called when a trial starts. Receives `{ subscription }`.                                                               |
| `onTrialEnd`              | `function`                   | Called when a trial ends. Receives `{ subscription }`.                                                                 |

#### Plan configuration

| Option            | Type     | Description                                           |
| ----------------- | -------- | ----------------------------------------------------- |
| `name`            | `string` | Plan name. **Required.**                              |
| `itemPriceId`     | `string` | Chargebee item price ID. **Required.**                |
| `itemId`          | `string` | Chargebee item ID. Optional.                          |
| `itemFamilyId`    | `string` | Chargebee item family ID. Optional.                   |
| `type`            | `string` | `"plan"` \| `"addon"` \| `"charge"`. **Required.**   |
| `limits`          | `object` | Limits (e.g. `{ projects: 10, storage: 5 }`).         |
| `freeTrial`       | `object` | Free trial config. See [below](#free-trial-configuration). |
| `trialPeriod`     | `number` | Trial period length. Optional.                        |
| `trialPeriodUnit` | `string` | `"day"` \| `"month"`. Optional.                       |
| `billingCycles`   | `number` | Number of billing cycles. Optional.                   |

#### Free trial configuration

| Option | Type     | Description                         |
| ------ | -------- | ----------------------------------- |
| `days` | `number` | Number of trial days. **Required.** |

### Organization Options

| Option                    | Type       | Description                                                                                                              |
| ------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `enabled`                 | `boolean`  | Enable Organization Customer support. **Required.**                                                                      |
| `getCustomerCreateParams` | `function` | Customize Chargebee customer creation parameters for organizations. Receives `organization` and context.                 |
| `onCustomerCreate`        | `function` | Called after an organization customer is created. Receives `{ chargebeeCustomer, organization }` and context.            |

## Advanced Usage

### Using with Organizations

The Chargebee plugin integrates with the [organization plugin](https://www.better-auth.com/docs/plugins/organization) to enable organizations as Chargebee Customers. Instead of individual users, organizations become the billing entity for subscriptions. This is useful for B2B services where billing is tied to the organization rather than individual users.

> **When Organization Customer is enabled:**
>
> - A Chargebee Customer is automatically created when an organization first subscribes
> - Organization name changes are synced to the Chargebee Customer
> - Organizations with active subscriptions cannot be deleted

#### Enabling Organization Customer

To enable Organization Customer, set `organization.enabled` to `true` and ensure the organization plugin is installed:

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

When `organization.enabled: true`, the plugin automatically omits `chargebeeCustomerId` from the `user` table and disables user-level billing hooks — no extra column or migration needed for the user table.

#### Creating Organization Subscriptions

Even with Organization Customer enabled, user subscriptions remain available and are the default. To use the organization as the billing entity, pass `customerType: "organization"`:

```ts
await authClient.subscription.create({
    itemPriceId: "team-USD-Monthly",
    referenceId: activeOrg.id,
    customerType: "organization",
    seats: 10,
    successUrl: "/org/billing/success",
    cancelUrl: "/org/billing"
});
```

#### Authorization

Implement `authorizeReference` to verify that the user has permission to manage subscriptions for the organization:

```ts
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

#### Organization Billing Email

Unlike users, organization billing email is not automatically synced because organizations don't have a unique email. Organizations often use a dedicated billing email separate from user accounts. To change the billing email after checkout, update it through the Chargebee Dashboard or implement custom logic using `chargebeeClient`:

```ts
await chargebeeClient.customer.update(organization.chargebeeCustomerId, {
    email: "billing@company.com"
});
```

### Custom Hosted Page Parameters

You can customize the Chargebee Hosted Page with additional parameters:

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

### Trial Period Management

The Chargebee plugin automatically prevents users from getting multiple free trials. Once a user has used a trial period (regardless of which plan), they will not be eligible for additional trials on any plan.

**How it works:**
- The system tracks trial usage across all plans for each user
- When a user subscribes to a plan with a trial, the system checks their subscription history
- If the user has ever had a trial (indicated by `trialStart`/`trialEnd` fields or `in_trial` status), no new trial will be offered
- This prevents abuse where users cancel subscriptions and resubscribe to get multiple free trials

**Example scenario:**
1. User subscribes to "Starter" plan with 7-day trial
2. User cancels the subscription after the trial
3. User tries to subscribe to "Premium" plan — no trial will be offered
4. User will be charged immediately for the Premium plan

This behavior is automatic and requires no additional configuration when `preventDuplicateTrials` is enabled.

## Error Handling

The plugin exposes typed error codes for handling failures:

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

1. Run `npx better-auth generate` to regenerate your schema with the Chargebee plugin fields
2. Apply the migration to your database
3. If manually migrating from another adapter, ensure your column names match your database adapter's conventions
4. Refer to the [Better Auth adapter documentation](https://www.better-auth.com/docs/concepts/database) for field name mapping specific to your adapter (Prisma, Drizzle, Kysely, etc.)

### Webhook Issues

If webhooks aren't being processed correctly:

1. Check that your webhook URL is correctly configured in the Chargebee dashboard (e.g. `https://your-domain.com/api/auth/chargebee/webhook`)
2. Verify that the Basic Auth credentials (`webhookUsername` and `webhookPassword`) are correct
3. Ensure you've selected all the necessary events in the Chargebee dashboard
4. Check your server logs for any errors during webhook processing

### Subscription Status Issues

If subscription statuses aren't updating correctly:

1. Make sure the webhook events are being received and processed
2. Check that the `chargebeeCustomerId` and `chargebeeSubscriptionId` fields are correctly populated
3. Verify that the reference IDs match between your application and Chargebee

### Testing Webhooks Locally

For local development, you can use a tunnel (e.g. ngrok) to forward webhooks to your local environment:

```bash
ngrok http 3000
```

Then configure your Chargebee webhook to point to:

```
https://your-ngrok-url/api/auth/chargebee/webhook
```

Make sure to use the same Basic Auth credentials in Chargebee and in your local environment variables.

## Resources

- [Chargebee Documentation](https://www.chargebee.com/docs/)
- [Better Auth Documentation](https://www.better-auth.com/)
- [Example: Next.js + Chargebee + Better Auth](https://github.com/chargebee/js-framework-adapters/tree/main/examples/next-chargebee-better-auth)
