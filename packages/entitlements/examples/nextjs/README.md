# Next.js example

Checks entitlements in a Next.js 16 App Router app, both in server components and in the browser through the relay.

```sh
# once, from packages/entitlements: build the package this example links to
pnpm install && pnpm build

# then, from this folder
pnpm i
pnpm start
```

Open http://localhost:3000 and sign in as one of the demo users.

## Mock or real Chargebee

Without `CHARGEBEE_SITE` and `CHARGEBEE_API_KEY` in `.env`, the Chargebee SDK's HTTP client is replaced with [canned responses](./src/lib/mock-chargebee.ts). The page shows a notice and lists the demo users with what each should get. Each call is logged in the terminal as `[mock chargebee]`. To use your site, copy `.env.example` to `.env`, fill it in, and point the demo users in [`src/lib/users.ts`](./src/lib/users.ts) and the features in [`src/lib/features.ts`](./src/lib/features.ts) at your customer and feature IDs.

## How it works

```
             server component ──► entitlements.for(target) ─┐
                                                            ├─► server client ─► memory cache ─► Chargebee
 browser client ─GET /api/entitlements─► relay route ───────┘
```

- The server client in [`src/lib/entitlements.ts`](./src/lib/entitlements.ts) holds the API key and caches snapshots in memory.
- The relay in [`src/app/api/entitlements/route.ts`](./src/app/api/entitlements/route.ts) takes the customer from the session cookie and returns a sanitized snapshot. It answers 401 when signed out and rejects `customerId` and `subscriptionId` query parameters.
- [`EntitlementsProvider`](./src/components/entitlements-provider.tsx) loads that snapshot into the browser client, and `useFeature(feature)` evaluates it synchronously. [`FeatureGate`](./src/components/feature-gate.tsx) uses it to show a component only when the feature is granted.
- [`/reports`](./src/app/reports/page.tsx) is gated on the server, so users without the feature never receive its content.

## What to look for

| User | Plan | Shows |
| --- | --- | --- |
| Alice | Pro | Every feature `granted`; `Export report` enabled |
| Bob | Free | `advanced-reports` is `disabled`; `support-tier` is `not-found` and falls back to its default |
| Carol | none | Customer missing from Chargebee: the server falls back to defaults, the relay answers 502 |

- Reload the page: the server section's `source` changes from `api` to `cache`.
- The browser section reads from `relay` and stays `pending` until the snapshot arrives.
