# Chargebee OpenFeature provider

`@chargebee/openfeature` exposes Chargebee Entitlements through the OpenFeature
server and web SDKs. It supports customer-level consolidated entitlements,
subscription-level entitlements, tiered memory/Redis caching, and an
authenticated browser relay for Next.js 16.

## Install

Install only the OpenFeature SDKs used by your application:

```sh
pnpm add @chargebee/openfeature chargebee @openfeature/server-sdk
pnpm add @openfeature/web-sdk
```

For React client components, also install `@openfeature/react-sdk`.

## Server provider

Pass an initialized Chargebee client to the provider. Chargebee credentials
remain entirely in server code.

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

Evaluate Chargebee feature IDs as OpenFeature flag keys. `targetingKey` remains
the application's subject ID and is never assumed to be a Chargebee ID.

```ts
const enabled = await OpenFeature.getClient().getBooleanValue(
  "advanced-reports",
  false,
  {
    targetingKey: session.user.id,
    chargebeeCustomerId: session.user.chargebeeCustomerId,
  },
);
```

For subscription-scoped evaluation:

```ts
const seats = await OpenFeature.getClient().getNumberValue(
  "licensed-seats",
  0,
  {
    targetingKey: session.user.id,
    chargebeeEvaluationMode: "subscription",
    chargebeeSubscriptionId: subscription.id,
  },
);
```

You can replace the built-in context keys with `resolveTarget(context)` when
your application has a different context model.

## Entitlement mapping

| Chargebee value | OpenFeature evaluation |
| --- | --- |
| Switch (`true`, `false`, or `available`) | Boolean |
| Custom level | String |
| Quantity or range | Number |
| `unlimited` | `Number.POSITIVE_INFINITY` with `unlimited` metadata |
| Full sanitized entitlement | Object |

Disabled or expired entitlements return the caller's default with the
`DISABLED` reason. Missing features return `FLAG_NOT_FOUND`; invalid value
types return `TYPE_MISMATCH`.

## Caching

The provider fetches and caches the complete entitlement snapshot for a
customer or subscription. Evaluating multiple flags for the same target does
not make additional Chargebee calls.

The default L1 cache is a bounded in-memory LRU with a 30-second TTL. Add a
shared Redis L2 cache for multi-instance or serverless deployments:

```ts
import {
  createRedisEntitlementsCache,
  TieredEntitlementsCache,
} from "@chargebee/openfeature/cache";

const redisCache = createRedisEntitlementsCache({
  get: (key) => redis.get(key),
  set: async (key, value, ttlMs) => {
    await redis.set(key, value, { PX: ttlMs });
  },
  delete: async (key) => {
    await redis.del(key);
  },
});

const cache = new TieredEntitlementsCache({
  redis: redisCache,
  memoryTtlMs: 30_000,
  redisTtlMs: 5 * 60_000,
});

export const entitlementsProvider = new ChargebeeEntitlementsProvider({
  chargebeeClient: chargebee,
  cache,
  cacheNamespace: "my-app:chargebee:entitlements:v1",
});
```

The adapter is client-agnostic. Adapt other Redis clients as follows:

```ts
// ioredis
set: async (key, value, ttlMs) => {
  await ioRedis.set(key, value, "PX", ttlMs);
}

// @upstash/redis
set: async (key, value, ttlMs) => {
  await upstash.set(key, value, { px: ttlMs });
}
```

Lookup order is memory, Redis, then Chargebee. Redis failures degrade to the
memory cache and Chargebee API. Concurrent misses in one process are
deduplicated.

Invalidate both cache layers after processing relevant Chargebee webhooks:

```ts
await entitlementsProvider.invalidate({
  mode: "customer",
  customerId,
});
```

Other application instances can retain an L1 value for at most the configured
short memory TTL after Redis invalidation.

## Next.js 16 browser relay

The OpenFeature Web SDK evaluates synchronously and cannot call Chargebee
directly because the Chargebee API key is secret. The web provider loads a
sanitized snapshot from an authenticated application endpoint.

Create an App Router route:

```ts
// app/api/entitlements/route.ts
import { createChargebeeEntitlementsHandler } from "@chargebee/openfeature/nextjs";
import { entitlementsProvider } from "@/lib/entitlements";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createChargebeeEntitlementsHandler({
  provider: entitlementsProvider,
  resolveContext: async (request) => {
    const session = await getSession(request);
    if (!session?.user.chargebeeCustomerId) return null;

    return {
      targetingKey: session.user.id,
      chargebeeCustomerId: session.user.chargebeeCustomerId,
    };
  },
});
```

`resolveContext` must derive billing identity from the authenticated server
session. The relay rejects Chargebee identity query parameters, emits
`private, no-store` responses, and never returns customer IDs, subscription
IDs, or credentials.

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

The browser provider fetches with `cache: "no-store"` and same-origin
credentials, stores the snapshot in memory, refreshes it when OpenFeature
context changes, and performs synchronous evaluations. Expired snapshots fail
closed to caller defaults.

Browser billing identity always comes from `resolveContext` on the server, not
from browser OpenFeature context. For subscription-scoped browser access, have
the authenticated callback select and authorize the subscription from server
session state. Use separate relay URLs/OpenFeature domains when a page needs
independent snapshots for multiple subscriptions.

## Operational notes

- Customer mode uses `consolidate_entitlements=true` by default.
- Chargebee pagination is followed with a page size of 100.
- The default server cache fails closed after expiry; stale grants are not
  served.
- Node.js is the supported Next.js runtime. Edge compatibility depends on the
  application's Chargebee and authentication setup.
- Call `OpenFeature.close()` during long-lived process shutdown.
