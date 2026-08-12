# Changelog

## Unreleased

- Extracted all framework/SDK-agnostic logic (snapshot caching, background
  refresh, Chargebee loading, evaluation, the browser relay) into a new
  package, [`@chargebee/entitlements`](https://github.com/chargebee/js-framework-adapters/blob/main/packages/entitlements/README.md).
  `@chargebee/openfeature` is now a thin adapter that implements OpenFeature's
  `Provider` interface over `@chargebee/entitlements`'s `ChargebeeEntitlements`
  (server) and `ChargebeeEntitlementsWebClient` (web) clients. Use
  `@chargebee/entitlements` directly if you don't need an OpenFeature SDK.
  - **Breaking:** removed the `/cache` and `/nextjs` subpaths, and the
    `chargebee`, `ioredis`, and `next` peer dependencies — import
    `createMemoryEntitlementsCache`/`createRedisEntitlementsCache` from
    `@chargebee/entitlements/cache` and `createEntitlementsRelayHandler` from
    `@chargebee/entitlements/nextjs` (or `/server`) instead.
  - **Breaking:** `ChargebeeEntitlementsProvider` and
    `ChargebeeEntitlementsWebProvider` no longer implement snapshot/cache
    logic themselves; construct a `ChargebeeEntitlements` /
    `ChargebeeEntitlementsWebClient` and pass it as `{ entitlements }` (or
    keep passing the same options — the provider constructs one for you) and
    read it back via the new `.entitlements` / `.client` properties.
  - The default cache-key namespace moved with the cache module and changed
    from `chargebee:openfeature:v1` to `chargebee:entitlements:v1`; pass
    `cacheNamespace` explicitly if you need to keep reading previously cached
    keys.
- Replaced the tiered cache with a `cache` slot in front of a durable `store`
  slot on the server provider; both accept any `EntitlementsCache`.
- Added `refreshOnMiss: "background"` so a missing snapshot resolves to caller
  defaults with reason `STALE` while it loads, plus `onSnapshotRefreshed` and
  `onError` callbacks.
- Added explicit `refreshSnapshot`, `writeSnapshot`, and `deleteSnapshot`,
  replacing `invalidate`, `evictSnapshot`, and `purgeSnapshot`.
- Stored snapshots are now served past `expiresAt` while refreshing in the
  background instead of failing the evaluation.
- The memory and Redis cache adapters take their own `ttlMs` option (60s
  default) so cache expiry can be configured where the cache is created;
  `cacheTtlMs` on the provider now overrides it per write when set.
- `refreshSnapshot` evicts the cached snapshot before fetching from Chargebee,
  and the new `evictCachedSnapshot` drops the cached copy without fetching, so
  a webhook-driven refresh cannot be shadowed by stale cached values.
- Explicit primes now supersede request refreshes already in flight instead of
  reusing a fetch that may have started before the webhook change.
- Renamed the `EntitlementsCache` interface to `EntitlementsStorage` since the
  same contract also backs the durable `store` slot, not just the cache.
- Renamed the `EntitlementCacheSource` type to `SnapshotSource`, since it
  enumerates every place a snapshot can come from (`api`, `cache`, `store`,
  `relay`), not only cache sources.
- Replaced the `MemoryEntitlementsCache` class with a `createMemoryEntitlementsCache`
  factory, matching `createRedisEntitlementsCache`.
- Renamed `createChargebeeEntitlementsHandler` (`@chargebee/openfeature/nextjs`)
  to `createEntitlementsRelayHandler`, matching the generic handler of the same
  name on `@chargebee/openfeature/server`. Removed the redundant
  `createChargebeeEntitlementsRoute` — return `createEntitlementsRelayHandler(...)`
  directly as your route's `GET` export.
- `createEntitlementsRelayHandler` on `@chargebee/openfeature/server` is now
  generic over the request type, so the Next.js entry point instantiates it
  for `NextRequest` instead of duplicating its request-handling logic.
- `createRedisEntitlementsCache` now takes an `ioredis` client directly instead
  of a hand-adapted `get`/`set`/`delete` object. `ioredis` is a new optional
  peer dependency. Other Redis-compatible clients (e.g. Upstash) should
  implement `EntitlementsStorage` directly.
- `@chargebee/openfeature/server` and `@chargebee/openfeature/web` no longer
  re-export shared domain types (`ChargebeeTarget`, `ChargebeeEntitlement`,
  `ChargebeeEntitlementsSnapshot`, `ChargebeeEvaluationMode`,
  `CHARGEBEE_CONTEXT_KEYS`, etc.). Import these from the root
  `@chargebee/openfeature` package, which has no peer-dependency
  requirements. This removes three independently drifting copies of the same
  export list in favor of one canonical source.
- `@chargebee/openfeature/nextjs` no longer re-exports `ChargebeeEntitlementsProvider`
  / `ChargebeeEntitlementsProviderOptions`; import those from
  `@chargebee/openfeature/server`, where the provider is actually constructed.
- Moved each subpath's barrel file into its module folder as `index.ts`
  (e.g. `src/cache.ts` → `src/cache/index.ts`) so there is a single canonical
  entry point per module instead of a flat file alongside its own folder.
  Purely internal; the published subpaths are unchanged.

## 0.1.0

- Initial Chargebee Entitlements providers for the OpenFeature server and web SDKs.
- Secure framework-neutral and Next.js 16 entitlement relay helpers.
- Tiered in-memory and client-agnostic Redis caching.
