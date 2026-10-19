# Chargebee OpenFeature provider

`@chargebee/openfeature` adapts
[`@chargebee/entitlements`](https://github.com/chargebee/js-framework-adapters/blob/main/packages/entitlements/README.md)'s
framework-agnostic Chargebee entitlements client to the
[OpenFeature](https://openfeature.dev) server and web SDKs. It supports
customer-level consolidated entitlements, subscription-level entitlements, and
Next.js 16 browser evaluation.

All caching, snapshot resolution, background refresh, and evaluation logic
lives in `@chargebee/entitlements`. This package only implements OpenFeature's
`Provider` interface on top of it — see that package's README for cache,
store, background-refresh, and browser-relay setup.

## Install

```sh
pnpm add @chargebee/openfeature @chargebee/entitlements chargebee @openfeature/server-sdk
pnpm add @openfeature/web-sdk
```

For React client components, also install `@openfeature/react-sdk`.

## Server provider

Pass an initialized Chargebee client to the provider — the same options
`ChargebeeEntitlements` takes. Chargebee credentials remain entirely in server
code.

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import Chargebee from "chargebee";
import { ChargebeeEntitlementsProvider } from "@chargebee/openfeature/server";

const chargebee = new Chargebee({
  site: process.env.CHARGEBEE_SITE!,
  apiKey: process.env.CHARGEBEE_API_KEY!,
});

export const entitlementsProvider = new ChargebeeEntitlementsProvider({
  chargebeeClient: chargebee,
});

await OpenFeature.setProviderAndWait(entitlementsProvider);
```

Evaluate Chargebee feature IDs as OpenFeature flag keys. The provider reads
`customerId` or `subscriptionId` off the evaluation context; `targetingKey`
remains the application's subject ID and is never assumed to be a Chargebee ID.

```ts
const enabled = await OpenFeature.getClient().getBooleanValue(
  "advanced-reports",
  false,
  {
    targetingKey: session.user.id,
    customerId: session.user.chargebeeCustomerId,
  },
);
```

A context carrying both `customerId` and `subscriptionId`, or neither,
resolves to the caller's default with `INVALID_CONTEXT`.

### Sharing a `ChargebeeEntitlements` instance

If you also need to evaluate entitlements outside of OpenFeature — for example
from a relay route, or a plain server action — construct the
`@chargebee/entitlements` client yourself and pass it in, instead of passing
raw options. The provider exposes it back as `.entitlements`, so all three call
sites share one cache and one set of in-flight requests:

```ts
import { ChargebeeEntitlements } from "@chargebee/entitlements/server";
import { createEntitlementsRelayHandler } from "@chargebee/entitlements/nextjs";
import { ChargebeeEntitlementsProvider } from "@chargebee/openfeature/server";

export const entitlements = new ChargebeeEntitlements({
  chargebeeClient: chargebee,
  cache,
  durableStore: postgresSnapshotStore,
});

export const entitlementsProvider = new ChargebeeEntitlementsProvider({
  entitlements,
});

// app/api/entitlements/route.ts
export const GET = createEntitlementsRelayHandler({ entitlements, resolveContext });
```

See `@chargebee/entitlements`'s README for cache/store configuration,
background refresh (`refreshOnMiss: "background"`), `refreshSnapshot` /
`deleteSnapshot`, and entitlement-to-flag-type mapping — the provider forwards
its constructor options to `ChargebeeEntitlements` unchanged.

## Next.js 16 browser relay

The OpenFeature Web SDK evaluates synchronously and cannot call Chargebee
directly because the Chargebee API key is secret. The web provider loads a
sanitized snapshot from an authenticated application endpoint, served by
`@chargebee/entitlements/nextjs` (see its README for the route handler).

Register the browser provider:

```tsx
"use client";

import {
  OpenFeature,
  OpenFeatureProvider,
} from "@openfeature/react-sdk";
import { ChargebeeEntitlementsWebProvider } from "@chargebee/openfeature/web";

const provider = new ChargebeeEntitlementsWebProvider({
  relayUrl: "/api/entitlements",
});

OpenFeature.setProvider(provider);

export function FeatureProvider({ children }: { children: React.ReactNode }) {
  return <OpenFeatureProvider>{children}</OpenFeatureProvider>;
}
```

Browser billing identity always comes from `resolveContext` on the relay's
server route, not from browser OpenFeature context — the browser provider's
`onContextChange` only triggers a re-fetch. For subscription-scoped browser
access, have the authenticated callback select and authorize the subscription
from server session state. Use separate relay URLs/OpenFeature domains when a
page needs independent snapshots for multiple subscriptions.

## Operational notes

- Call `OpenFeature.close()` during long-lived process shutdown; it calls
  through to `entitlements.close()`.
- See `@chargebee/entitlements`'s README for entitlement mapping, snapshot
  freshness, and Chargebee pagination details — they apply unchanged here.
