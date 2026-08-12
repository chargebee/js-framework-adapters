# Chargebee Entitlements

`@chargebee/entitlements` resolves Chargebee entitlements — customer-level
consolidated entitlements or subscription-level entitlements — into typed
boolean/string/number/object values, with a shared cache in front of a
durable snapshot store, background refresh, and an authenticated browser
relay for Next.js 16. It has no dependency on any feature-flag SDK; use it
directly, or wrap it with an adapter such as
[`@chargebee/openfeature`](https://github.com/chargebee/js-framework-adapters/blob/main/packages/openfeature/README.md).

## Install

```sh
pnpm add @chargebee/entitlements chargebee
```

## Server client

Pass an initialized Chargebee client to the client. Chargebee credentials
remain entirely in server code.

```ts
import Chargebee from "chargebee";
import { ChargebeeEntitlements } from "@chargebee/entitlements/server";

const chargebee = new Chargebee({
  site: process.env.CHARGEBEE_SITE!,
  apiKey: process.env.CHARGEBEE_API_KEY!,
});

export const entitlements = new ChargebeeEntitlements({
  chargebeeClient: chargebee,
});
```

Evaluate Chargebee feature IDs directly against a `ChargebeeTarget`:

```ts
const enabled = await entitlements.getBooleanValue("advanced-reports", false, {
  mode: "customer",
  customerId: session.user.chargebeeCustomerId,
});
```

For subscription-scoped evaluation:

```ts
const seats = await entitlements.getNumberValue("licensed-seats", 0, {
  mode: "subscription",
  subscriptionId: subscription.id,
});
```

You can also pass a context-shaped bag instead of an explicit target —
useful when the same object already carries an application's subject ID and
Chargebee identity (e.g. an OpenFeature evaluation context, or your own
request context):

```ts
const enabled = await entitlements.getBooleanValue("advanced-reports", false, {
  targetingKey: session.user.id,
  chargebeeCustomerId: session.user.chargebeeCustomerId,
});
```

`targetingKey` is never assumed to be a Chargebee ID. Replace the built-in
context keys with `resolveTarget(context)` when your application has a
different context model.

## Entitlement mapping

| Chargebee value | Resolved as |
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

The client fetches and caches the complete entitlement snapshot for a
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
import { createRedisEntitlementsCache } from "@chargebee/entitlements/cache";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);
const cache = createRedisEntitlementsCache(redis, { ttlMs: 60_000 });

export const entitlements = new ChargebeeEntitlements({
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
import type { EntitlementsStorage } from "@chargebee/entitlements/cache";
import { parseSerializedEntitlementsSnapshot, serializeEntitlementsSnapshot } from "@chargebee/entitlements";

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
option (60s by default), and the client's `cacheTtlMs` overrides it per write
if you would rather configure expiry alongside the client. Expiry matters most
for the cache created by `createMemoryEntitlementsCache`, which no other
process can evict — with several instances running, its `ttlMs` is the worst
case for how long one of them keeps serving entitlements a webhook has already
replaced.

`snapshotTtlMs` stamps `expiresAt` on the snapshot and decides when it is
refreshed from Chargebee. A store should not delete rows at `expiresAt`: the
client serves an expired snapshot and refreshes it in the background, so
entitlements survive a Chargebee outage. Cache and store read failures degrade
to the next step and are reported through `onError`. Concurrent refreshes for
one target are deduplicated, and a failed refresh is not retried for
`refreshBackoffMs`.

Refresh the snapshot after processing relevant Chargebee webhooks, and remove
it when the target no longer exists:

```ts
await entitlements.refreshSnapshot({ mode: "subscription", subscriptionId });
await entitlements.deleteSnapshot({ mode: "customer", customerId });
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
example — the client starts the refresh, and evaluations resolve to the
caller's default value with reason `STALE` and `snapshotPending` metadata. The
application can render its free-tier experience and re-check once
`onSnapshotRefreshed` fires with `trigger: "request"`:

```ts
const entitlements = new ChargebeeEntitlements({
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

## Browser client and relay

The browser can't call Chargebee directly because the Chargebee API key is
secret. `ChargebeeEntitlementsWebClient` loads a sanitized snapshot from an
authenticated application endpoint and evaluates flags synchronously.

Create an App Router route:

```ts
// app/api/entitlements/route.ts
import { createEntitlementsRelayHandler } from "@chargebee/entitlements/nextjs";
import { entitlements } from "@/lib/entitlements";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createEntitlementsRelayHandler({
  entitlements,
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
IDs, or credentials. `createEntitlementsRelayHandler` from
`@chargebee/entitlements/server` is the framework-neutral version, generic
over the request type; the `/nextjs` entry point instantiates it for
`NextRequest`.

Use the browser client directly:

```ts
import { ChargebeeEntitlementsWebClient } from "@chargebee/entitlements/web";

const entitlements = new ChargebeeEntitlementsWebClient({
  relayUrl: "/api/entitlements",
});

await entitlements.initialize();
const enabled = entitlements.getBooleanValue("advanced-reports", false);
```

The browser client fetches with `cache: "no-store"` and same-origin
credentials, stores the snapshot in memory, and performs synchronous
evaluations. Expired snapshots fail closed to caller defaults; pass `onStale`,
`onConfigurationChanged`, or `onError` callbacks to observe those transitions
(for example, to re-render once a stale snapshot has refreshed). Call `reset()`
when the session's billing subject changes (e.g. sign-in/sign-out) to clear the
snapshot and reload it, and `close()` during teardown.

Browser billing identity always comes from `resolveContext` on the server, not
from the browser. For subscription-scoped browser access, have the
authenticated callback select and authorize the subscription from server
session state. Use separate relay URLs when a page needs independent
snapshots for multiple subscriptions.

## Operational notes

- Customer mode uses `consolidate_entitlements=true` by default.
- Chargebee pagination is followed with a page size of 100.
- Without a `store`, an expired snapshot is refetched from Chargebee before the
  evaluation resolves; stale grants are not served.
- Node.js is the supported Next.js runtime. Edge compatibility depends on the
  application's Chargebee and authentication setup.
- Call `entitlements.close()` during long-lived process shutdown.

## Using with OpenFeature

If your application already standardizes on the
[OpenFeature](https://openfeature.dev) SDKs, wrap a `ChargebeeEntitlements` (or
`ChargebeeEntitlementsWebClient`) instance with
[`@chargebee/openfeature`](https://github.com/chargebee/js-framework-adapters/blob/main/packages/openfeature/README.md)
instead of calling this package's evaluation methods directly. Both approaches
share the same cache, store, and refresh behavior — `@chargebee/openfeature`
only translates method names and result shapes.
