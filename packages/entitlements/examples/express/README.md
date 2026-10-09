# Express example

Gates Express routes with `@chargebee/entitlements` on the server.

```sh
# once, from packages/entitlements: build the package this example links to
pnpm install && pnpm build

# then, from this folder
pnpm i
pnpm start
```

Open http://localhost:3000. Requires Node.js 22.18 or later, which runs the TypeScript sources directly.

## Mock or real Chargebee

Without `CHARGEBEE_SITE` and `CHARGEBEE_API_KEY` in `.env`, the Chargebee SDK's HTTP client is replaced with [canned responses](./src/mock-chargebee.ts) and each call is logged as `[mock chargebee]`. The page then lists the demo users with what each should get, and lets you sign in as one and call the routes from the browser.

With your site configured, the page lists curl commands instead, and requests name the user in the `x-user` header. To use your site, copy `.env.example` to `.env`, fill it in, and point the demo users in [`src/users.ts`](./src/users.ts) and the features in [`src/entitlements.ts`](./src/entitlements.ts) at your customer and feature IDs.

## What to look for

| User | Plan | Shows |
| --- | --- | --- |
| `alice` | Pro | Every feature `granted`; `/reports` allowed |
| `bob` | Free | `advanced-reports` is `disabled` (403 on `/reports`); `support-tier` is `not-found` and falls back to its default; all 3 seats taken |
| `carol` | none | Customer missing from Chargebee: every feature resolves to its default |

- `GET /me/entitlements` twice: `source` changes from `api` to `cache`, and the mock logs one call.
- `POST /webhooks/chargebee` refetches the customer's snapshot, as a subscription change would.

## Files

- [`src/entitlements.ts`](./src/entitlements.ts): the client, its memory cache, and the feature declarations.
- [`src/server.ts`](./src/server.ts): routes, the `requireFeature` middleware, and the webhook.
- [`src/demo-page.ts`](./src/demo-page.ts): the mock-mode page.
- [`src/chargebee.ts`](./src/chargebee.ts): picks the real or the mock Chargebee client.
