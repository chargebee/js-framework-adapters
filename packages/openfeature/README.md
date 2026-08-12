# Chargebee OpenFeature provider

`@chargebee/openfeature` exposes Chargebee Entitlements through the OpenFeature
server and web SDKs. It supports customer-level consolidated entitlements,
subscription-level entitlements, a shared cache in front of a durable snapshot
store, and an authenticated browser relay for Next.js 16.

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

## Snapshot resolution

The provider fetches and caches the complete entitlement snapshot for a
customer or subscription. Evaluating multiple flags for the same target does
not make additional Chargebee calls.

A snapshot is resolved in three steps:

1. `cache` — a shared, fast store such as Redis. It absorbs the many
   entitlement checks a single authenticated request makes.
2. `store` — a durable store such as PostgreSQL. It is the source of truth.
3. The Chargebee API — used only when the store has nothing, then written back
   to the store and the cache.

Both slots take the same `EntitlementsStorage` interface, so any backend can
fill either role. With neither configured, every miss goes to Chargebee.

```sh
pnpm add ioredis
```

```ts
import { createRedisEntitlementsCache } from "@chargebee/openfeature/cache";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);
const cache = createRedisEntitlementsCache(redis, { ttlMs: 60_000 });

export const entitlementsProvider = new ChargebeeEntitlementsProvider({
  chargebeeClient: chargebee,
  cache,
  store: postgresSnapshotStore,
  snapshotTtlMs: 24 * 60 * 60_000,
  cacheNamespace: "my-app:chargebee:entitlements:v1",
});
```

`createRedisEntitlementsCache` takes an [ioredis](https://github.com/redis/ioredis)
client (or anything with its `get`/`set`/`del` methods, such as a `Cluster`).
For another Redis client or a managed service like Upstash, implement the
three-method `EntitlementsStorage` interface directly instead:

```ts
import type { EntitlementsStorage } from "@chargebee/openfeature/cache";
import { parseSerializedEntitlementsSnapshot, serializeEntitlementsSnapshot } from "@chargebee/openfeature";

const cache: EntitlementsStorage = {
  get: async (key) => {
    const value = await upstash.get<string>(key);
    return value ? parseSerializedEntitlementsSnapshot(value) : undefined;
  },
  set: async (key, value, ttlMs = 60_000) => {
    await upstash.set(key, serializeEntitlementsSnapshot(value), { px: ttlMs });
  },
  delete: async (key) => {
    await upstash.del(key);
  },
};
```

Cache expiry bounds how long the cache may lag the store: when it lapses, the
next evaluation reads the store again. Both bundled adapters take a `ttlMs`
option (60s by default), and the provider's `cacheTtlMs` overrides it per write
if you would rather configure expiry alongside the provider. Expiry matters most
for the cache created by `createMemoryEntitlementsCache`, which no other
process can evict — with several instances running, its `ttlMs` is the worst
case for how long one of them keeps serving entitlements a webhook has already
replaced.

`snapshotTtlMs` stamps `expiresAt` on the snapshot and decides when it is
refreshed from Chargebee. A store should not delete rows at `expiresAt`: the
provider serves an expired snapshot and refreshes it in the background, so
entitlements survive a Chargebee outage. Cache and store read failures degrade
to the next step and are reported through `onError`. Concurrent refreshes for
one target are deduplicated, and a failed refresh is not retried for
`refreshBackoffMs`.

Refresh the snapshot after processing relevant Chargebee webhooks, and remove
it when the target no longer exists:

```ts
await entitlementsProvider.refreshSnapshot({ mode: "subscription", subscriptionId });
await entitlementsProvider.deleteSnapshot({ mode: "customer", customerId });
```

`refreshSnapshot` drops the cached copy before it calls Chargebee, so a webhook
that changed entitlements cannot be followed by a cache hit on the old values;
reads fall through to the store until the fresh snapshot lands. Use
`evictCachedSnapshot` on its own when you want that fall-through without
fetching, and `deleteSnapshot` to clear both layers. An explicit refresh also
supersedes any request refresh already in flight, because that fetch may have
started before the webhook's upstream change.

### Keeping Chargebee off the request path

`refreshOnMiss: "background"` never calls Chargebee while a request waits. When
neither the cache nor the store holds a snapshot — a brand-new subscriber, for
example — the provider starts the refresh, and evaluations resolve to the
caller's default value with reason `STALE` and `snapshotPending` metadata. The
application can render its free-tier experience and re-check once
`onSnapshotRefreshed` fires with `trigger: "request"`:

```ts
const provider = new ChargebeeEntitlementsProvider({
  chargebeeClient: chargebee,
  cache,
  store: postgresSnapshotStore,
  refreshOnMiss: "background",
  onSnapshotRefreshed: ({ target, trigger }) => {
    if (trigger === "request") notifySubscriptionReady(target);
  },
  onError: (error, { operation, target }) => {
    logger.error({ error, operation, target }, "entitlement snapshot");
  },
});
```

Because the default values carry the decision while a snapshot is pending, pass
defaults that match your lowest paid-for tier rather than your most permissive
one.

A background refresh continues after the response is sent, so on platforms that
freeze the process at that point, refresh snapshots from a webhook worker or a
reconciliation job instead of relying on request-triggered refreshes.

## Next.js 16 browser relay

The OpenFeature Web SDK evaluates synchronously and cannot call Chargebee
directly because the Chargebee API key is secret. The web provider loads a
sanitized snapshot from an authenticated application endpoint.

Create an App Router route:

```ts
// app/api/entitlements/route.ts
import { createEntitlementsRelayHandler } from "@chargebee/openfeature/nextjs";
import { entitlementsProvider } from "@/lib/entitlements";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createEntitlementsRelayHandler({
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
- Without a `store`, an expired snapshot is refetched from Chargebee before the
  evaluation resolves; stale grants are not served.
- Node.js is the supported Next.js runtime. Edge compatibility depends on the
  application's Chargebee and authentication setup.
- Call `OpenFeature.close()` during long-lived process shutdown.
