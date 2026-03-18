### v1.0.0-beta.5 (2026-03-18)
* * *

### Bug:
- Fixed `chargebeeCustomerId` column naming. The field definition in both `userSchema` and `orgSchema` had an explicit `fieldName: "chargebeeCustomerId"` that overrode Better Auth's built-in camelCase→snake_case mapping, causing the column to be created as `chargebeeCustomerId` instead of the expected `chargebee_customer_id`. The explicit override has been removed so Better Auth's automatic mapping applies correctly.


### v1.0.0-beta.4 (2026-03-18)
* * *

### Feature:
- Added `getCustomerCreateParams` option to `ChargebeeOptions`, allowing you to return additional Chargebee customer creation params (e.g. `first_name`, `last_name`, phone) for user customers. The callback receives the `user` object and an optional request `ctx` (available when the customer is created on-demand, not during sign-up).
- Registered the missing `GET /subscription/success` endpoint. Chargebee's `redirect_url` after hosted-page checkout points to this endpoint, which forwards the user to their original `successUrl`. Without this endpoint the post-checkout redirect resulted in a 404.
- When `organization.enabled: true`, the `chargebeeCustomerId` field is no longer added to the `user` table and user-level billing hooks are disabled. Previously the user schema was always included regardless of billing mode, causing adapter crashes if the column was missing from the database.
- Added `createSubscription` route to initiate a new Chargebee hosted checkout session.
- Added `updateSubscription` route to update an existing subscription via hosted page.
- Added `listActiveSubscriptions` route (`GET /subscription/list`) to retrieve the caller's active/trialing subscriptions enriched with plan `limits` and `itemPriceId`.
- Added a `user.delete` database hook that automatically cancels active Chargebee subscriptions and cleans up local subscription records when a user is deleted.
- Introduced `version.ts` to track and expose the package version, used to set the `__clientIdentifier` on the Chargebee client.
- Added `getOrCreateCustomerId` shared helper to deduplicate customer creation logic across routes, with race-condition protection via a fresh-read guard.

### Bug:
- Webhook handler no longer returns early when no matching plan is found for an `itemPriceId`; the subscription is still tracked and a warning is logged instead.

### Improvement:
- Added a startup warning when `webhookUsername` / `webhookPassword` are not configured, alerting that the webhook endpoint is unauthenticated.
- Extracted `isActiveOrTrialing` helper and used it consistently across hooks and routes.
- Renamed `onEvent` to `webhookHandler`, which now receives the typed `WebhookHandler` instance — use `handler.on(WebhookEventType.X, fn)` for per-event listeners with full type safety.

### Breaking Change:
- `cb.customer.create` no longer automatically splits `user.name` into `first_name` and `last_name`. Better Auth uses a single `user.name` field; pass name fields explicitly via `getCustomerCreateParams` if needed.
- The user update hook no longer syncs `first_name` / `last_name` to Chargebee — only `email` is synced.


### v1.0.0-beta.2 (2026-02-05)
* * *

### Dependency
- Bumped up the version for `better-auth` to `v1.5.3`.


### v1.0.0-beta.2 (2026-02-25)
* * *

### Docs:
- Improvise the Docs.

### Feature:
- Added support for custom hooks.

### Bug:
- Fixes the issue with subscription trial.
