# Chargebee Entitlements

The `@chargebee/entitlements` makes it easy to work with entitlements and features in the Chargebee ecosystem. It handles fetching entitlements, caching them for frequent use either in Redis or in-memory, maintains a durable snapshot in a database for updates. It also supports background refresh, and an authenticated browser relay for Next.js 16 apps. It is a standalone package, but can be used with the [`@chargebee/openfeature`](https://github.com/chargebee/js-framework-adapters/blob/main/packages/openfeature/README.md) adapter.

## Install

```sh
pnpm add @chargebee/entitlements chargebee
```

## Usage

Declare a feature once, then fetch its value wherever you need it:

```ts
import { Feature } from "@chargebee/entitlements";

// Declare a typed feature
const seats = new Feature<number>("licensed-seats", 0);

// Fetch the value at runtime for the given context (customerId or subscriptionId)
const count = await seats.get({ customerId: user.chargebeeCustomerId });

```

A feature takes an ID and a default value. The default value is mandatory and is required for type cohesion during runtime to convert the chargebee feature value into a primitive. However, the type parameter is optional, since TypeScript infers it from the default:

```ts
// features.ts
// export them individually
export const seats = new Feature("licensed-seats", 0); // Feature<number>
export const tier = new Feature("support-tier", "basic"); // Feature<string>
export const reports = new Feature("advanced-reports", false); // Feature<boolean>

// or as a grouped object
export default {
  seats: new Feature<number>("licensed-seats", 0),
  tier: new Feature<string>("support-tier", "basic"),
  reports: new Feature<boolean>("advanced-reports", false),
};

const count = await features.seats.get(target);
```

When you need the reason or Chargebee metadata behind a value, call
`getDetails` instead of `get`:

```ts
const { value, reason, flagMetadata } = await seats.getDetails(target);
```

## Targets

Every evaluation names one Chargebee subject: a customer, whose entitlements
are consolidated across their subscriptions, or a single subscription.

```ts
await seats.get({ customerId: user.chargebeeCustomerId });
await seats.get({ subscriptionId: subscription.id });
```

There is nothing else to configure — no mode, no default scope. Passing both
identifiers is rejected rather than resolved, because a customer's
consolidated entitlements and one subscription's entitlements are different
answers and guessing between them would hide the mistake. Passing neither is
rejected too; in particular, a `targetingKey` is never assumed to be a
Chargebee ID.

Any other properties on the object are ignored, so a request context you
already have on hand can be passed straight through:

```ts
const count = await seats.get({
  targetingKey: session.user.id,
  customerId: session.user.chargebeeCustomerId,
});
```

## Server client

Pass an initialized Chargebee client. Chargebee credentials remain entirely
in server code.

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

A standalone `new Feature(...)` needs a client to evaluate against. Register
one once during start-up:

```ts
import { setDefaultEntitlements } from "@chargebee/entitlements";
import { entitlements } from "@/lib/entitlements";

setDefaultEntitlements(entitlements);
```

To avoid the global, create features from the client instead — the returned
feature is bound to it:

```ts
const seats = entitlements.feature("licensed-seats", 0);
```

For call sites that want the full resolution rather than a declared feature,
the client evaluates a feature ID directly:

```ts
const resolution = await entitlements.getValue("licensed-seats", 0, {
  customerId: session.user.chargebeeCustomerId,
});
```

## Entitlement mapping

The default value's type decides how a stored value is read:

| Default value | Chargebee value | Resolved as |
| --- | --- | --- |
| `boolean` | Switch (`true`, `false`, `available`, or a bare grant) | Boolean |
| `string` | Any | The raw string |
| `number` | Quantity or range | Number |
| `number` | `unlimited` | `Number.POSITIVE_INFINITY` with `unlimited` metadata |
| object | Any | The full sanitized entitlement |

Disabled or expired entitlements return the caller's default with the
`DISABLED` reason. Missing features return `FLAG_NOT_FOUND`; a value that
cannot be read as the declared type returns `TYPE_MISMATCH`.

## Snapshot resolution

The client fetches and caches the complete entitlement snapshot for a
customer or subscription. Evaluating multiple flags for the same target does
not make additional Chargebee calls.

A snapshot is resolved in three steps:

1. `cache` — a shared, fast store such as Redis or in-memory. It absorbs the many
   entitlement checks a single authenticated request makes.
2. `durableStore` — a durable store such as PostgreSQL. It is the source of
   truth.
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
  durableStore: postgresSnapshotStore,
  snapshotTtlMs: 24 * 60 * 60_000,
  advanced: { cacheNamespace: "my-app:chargebee:entitlements:v1" },
});
```

`createRedisEntitlementsCache` takes an [ioredis](https://github.com/redis/ioredis)
client (or anything with its `get`/`set`/`del` methods, such as a `Cluster`).
For another Redis client or a managed service like Upstash, implement the
three-method `EntitlementsStorage` interface directly instead:

```ts
import type { EntitlementsStorage } from "@chargebee/entitlements/cache";
import {
  parseSerializedEntitlementsSnapshot,
  serializeEntitlementsSnapshot,
} from "@chargebee/entitlements/cache";

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
`advanced.refreshBackoffMs`.

Refresh the snapshot after processing relevant Chargebee webhooks, and remove
it when the target no longer exists:

```ts
await entitlements.refreshSnapshot({ subscriptionId });
await entitlements.deleteSnapshot({ customerId });
```

`refreshSnapshot` drops the cached copy before it calls Chargebee, so a webhook
that changed entitlements cannot be followed by a cache hit on the old values;
reads fall through to the store until the fresh snapshot lands. Use
`deleteSnapshot` to clear both layers. An explicit refresh also supersedes any
request refresh already in flight, because that fetch may have started before
the webhook's upstream change. `writeSnapshot` stores a snapshot you assembled
yourself, for example from a webhook payload, using `createEntitlementsSnapshot`.

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
  durableStore: postgresSnapshotStore,
  refreshOnMiss: "background",
  logger: console,
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

    return { customerId: session.user.chargebeeCustomerId };
  },
});
```

`resolveContext` must derive billing identity from the authenticated server
session. The relay rejects `customerId` and `subscriptionId` query parameters,
emits `private, no-store` responses, and never returns customer IDs,
subscription IDs, or credentials. `createEntitlementsRelayHandler` from
`@chargebee/entitlements/server` is the framework-neutral version, generic
over the request type; the `/nextjs` entry point instantiates it for
`NextRequest`.

Because the relay snapshot is already scoped to the authenticated session,
features evaluated in the browser take no target at all:

```ts
import { ChargebeeEntitlementsWebClient } from "@chargebee/entitlements/web";
import { setDefaultEntitlements } from "@chargebee/entitlements";

const webClient = new ChargebeeEntitlementsWebClient({
  relayUrl: "/api/entitlements",
});
await webClient.initialize();
setDefaultEntitlements(webClient);

// The same declarations used on the server, evaluated against the session
// snapshot already in memory:
const count = await features.seats.get();
```

Or evaluate a feature ID directly, which the web client does synchronously:

```ts
const resolution = webClient.getValue("advanced-reports", false);
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
- Without a `durableStore`, an expired snapshot is refetched from Chargebee
  before the evaluation resolves; stale grants are not served.
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
