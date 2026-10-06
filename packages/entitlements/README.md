# Chargebee Entitlements

Package `@chargebee/entitlements` makes it easy to gate app features by evaluating them against Chargebee's entitlements. It fetches a customer's or subscription's entitlements once, caches them in Redis or in memory, keeps a durable snapshot in your database, and refreshes it in the background.

You can use it on the server or on the browser with minimal configuration. We have an [adapter](./src/nextjs.ts) for Next.js apps as well.

```sh
pnpm add @chargebee/entitlements chargebee
```

## Quick start

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

const seats = entitlements.feature("licensed-seats", 0); // Feature<number>
const count = await seats.get({ customerId: user.chargebeeCustomerId });
```

## Features

A feature is an ID and a default value. Chargebee stores every value as a string, and the default's type decides how it is read:

| Default value | Chargebee value | Resolved as |
| --- | --- | --- |
| `boolean` | Switch (`true`, `false`, `available`, or a bare grant) | Boolean |
| `string` | Any | The raw string |
| `number` | Quantity or range; `unlimited` | Number; `Number.POSITIVE_INFINITY` |
| object | Any | The full sanitized entitlement |

Features can be bound to a client, as show above, or declared once and shared between server and browser code. Standalone features use the client registered with `setDefaultEntitlements`:

```ts
// features.ts
import { Feature, setDefaultEntitlements } from "@chargebee/entitlements";

export const seats = new Feature("licensed-seats", 0);
export const reports = new Feature("advanced-reports", false);

// at start-up
setDefaultEntitlements(entitlements);
```

`get` returns the value. `getDetails` also says why:

```ts
const { value, status, source, entitlement, error } = await seats.getDetails(target);
```

| `status` | Meaning | `value` |
| --- | --- | --- |
| `granted` | Enabled and read as the declared type | Chargebee's value |
| `disabled` | Disabled or expired | Default |
| `pending` | No snapshot loaded yet | Default |
| `stale` | Browser snapshot expired and refreshing | Default |
| `error` | `error.code` is `not-found`, `type-mismatch`, `invalid-target`, or `unavailable` | Default |

`source` is `api`, `cache`, `store`, or `relay`, and `entitlement` is the Chargebee entitlement behind the value.

## Targets

A target is `{ customerId }`, whose entitlements are consolidated across the customer's subscriptions, or `{ subscriptionId }`. Passing both or neither resolves to `invalid-target`, so the package never guesses which one you meant. Other properties are ignored, so a request context can be passed straight through.

The server client evaluates a feature ID directly, or binds a target once per request with `for`:

```ts
await entitlements.get("licensed-seats", 0, { customerId });

const scoped = entitlements.for({ customerId });
await scoped.get("licensed-seats", 0);
await scoped.feature("advanced-reports", false).get();
```

A bound feature's `get` requires a target on the server client and takes none on a scoped or browser client. Getting this wrong fails to compile.

## Caching and storage

The client loads the complete snapshot for a target, so evaluating several features makes one Chargebee call. It looks for the snapshot in this order:

1. `cache`: fast storage that absorbs the many checks one request makes.
2. `durableStore`: the source of truth, such as a PostgreSQL table.
3. Chargebee, only when the store is empty. The result is written back to both.

Both slots take the same `EntitlementsStorage` interface (`get`, `set`, `delete`). With neither configured, every miss goes to Chargebee.

```ts
import {
  createMemoryEntitlementsCache,
  createRedisEntitlementsCache,
} from "@chargebee/entitlements/cache";
import Redis from "ioredis";

// Redis when available (pnpm add ioredis), otherwise in-process memory
const cache = process.env.REDIS_URL
  ? createRedisEntitlementsCache(new Redis(process.env.REDIS_URL))
  : createMemoryEntitlementsCache({ maxEntries: 500 });

export const entitlements = new ChargebeeEntitlements({
  chargebeeClient: chargebee,
  cache,
  durableStore: postgresSnapshotStore,
  snapshotTtlMs: 24 * 60 * 60_000,
});
```

The Redis cache takes an [ioredis](https://github.com/redis/ioredis) client, a `Cluster`, or a custom implementation that satisfies the `RedisEntitlementsCacheClient` interface.

The memory cache is a simple in-process LRU cache which holds `maxEntries` (500 by default) snapshots by default before eviction. Each process keeps its own copy, and a webhook refresh only clears the copy in the process that handled it. Due to inconsistencies this may cause, it's strongly suggested that production deployments use the Redis cache instead.

Both caches expire entries after `ttlMs` (60 seconds by default), and the client's `cacheTtlMs` overrides that per write. `snapshotTtlMs` (5 minutes by default) decides when a snapshot is refreshed from Chargebee. Don't delete store rows at `expiresAt`: the client serves an expired snapshot while it refreshes in the background, which keeps entitlements available during a
Chargebee outage.

Cache and store read failures fall through to the next step and are reported through `onError`. Concurrent refreshes for one target are deduplicated, and a failed refresh waits `advanced.refreshBackoffMs` (10 seconds) before retrying.

## Webhooks

```ts
await entitlements.refreshSnapshot({ subscriptionId });
await entitlements.deleteSnapshot({ customerId });
```

`refreshSnapshot` drops the cached copy before calling Chargebee, so reads fall through to the store until the fresh snapshot lands. It also replaces any refresh a request started earlier. `deleteSnapshot` clears the cache and the store. To save a snapshot you built yourself, for example from a webhook payload, pass `createEntitlementsSnapshot(...)` to `writeSnapshot`.

## Background refresh

With `refreshOnMiss: "background"`, requests never wait on Chargebee. When no snapshot exists yet, evaluations return the default with status `pending` while the client fetches one, and `onSnapshotRefreshed` fires when it lands:

```ts
new ChargebeeEntitlements({
  chargebeeClient: chargebee,
  refreshOnMiss: "background",
  onSnapshotRefreshed: ({ target, trigger }) => {
    if (trigger === "request") notifySubscriptionReady(target);
  },
  onError: (error, { operation, target }) => logger.error({ error, operation, target }),
});
```

Pending evaluations return the default values, so set them to your lowest paid tier. On platforms that freeze the process after the response, refresh from a webhook worker or a scheduled job instead.

## Browser

The Chargebee API key is secret, so the browser loads a sanitized snapshot from a relay route in your app:

```ts
// app/api/entitlements/route.ts
import { createEntitlementsRelayHandler } from "@chargebee/entitlements/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createEntitlementsRelayHandler({
  entitlements,
  resolveContext: async (request) => {
    const session = await getSession(request);
    return session?.user.chargebeeCustomerId
      ? { customerId: session.user.chargebeeCustomerId }
      : null; // 401
  },
});
```

`resolveContext` must take the billing identity from the authenticated session. The relay rejects `customerId` and `subscriptionId` query parameters, responds with `private, no-store`, and never returns IDs or credentials. Outside Next.js, use the request-generic `createEntitlementsRelayHandler` from `/server`.

The browser client has the server client's name and methods, without the target, and evaluates synchronously:

```ts
import { ChargebeeEntitlements } from "@chargebee/entitlements/web";

const entitlements = new ChargebeeEntitlements({ relayUrl: "/api/entitlements" });
await entitlements.initialize();
setDefaultEntitlements(entitlements);

entitlements.get("advanced-reports", false);
await seats.get(); // shared features take no target
```

Before the first load, evaluations return `pending`. Expired snapshots return defaults with status `stale` while the client refetches. Observe this with `onSnapshotExpired`, `onSnapshotRefreshed` (which lists `changedFeatureIds`), and `onError`. Call `reset()` when the signed-in billing subject changes and `close()` on teardown. For subscription-scoped access, pick and authorize the subscription in `resolveContext`, with one relay URL per subscription.

## Notes

- Customer targets use `consolidate_entitlements=true` by default.
- Without a `durableStore`, an expired snapshot is refetched before the evaluation resolves, as long as the cache `ttlMs` is shorter than `snapshotTtlMs`.
- Node.js is the supported Next.js runtime.
- Call `entitlements.close()` when a long-lived process shuts down.
- For OpenFeature SDKs, use [`@chargebee/openfeature`](https://github.com/chargebee/js-framework-adapters/blob/main/packages/openfeature/README.md). It shares this package's caching and only maps `status` and `error.code` onto OpenFeature reasons and error codes.
