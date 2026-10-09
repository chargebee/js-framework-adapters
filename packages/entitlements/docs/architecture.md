# Entitlement resolution

Companion to [`architecture.html`](./architecture.html). Open it in a browser to step through each scenario.

## Components

| Node | Role |
|---|---|
| User / Browser | Logged-in user. Server pages, or the `@chargebee/entitlements/web` client. |
| App server | Route, middleware, or relay handler. Derives the target from the session. |
| Entitlements SDK | `ChargebeeEntitlements` (server). Resolves snapshots, dedupes in-flight refreshes, backs off after failures. |
| Cache | `cache` option: Redis or in-memory LRU. Entry TTL `cacheTtlMs` (60s default). |
| Durable store | `durableStore` option: source of truth, e.g. a Postgres table. User-supplied `EntitlementsStorage`; the library ships no Postgres adapter. |
| Chargebee API | Customer or subscription entitlements, 100 per page, max 50 pages. |
| Webhook worker | Calls `refreshSnapshot` / `writeSnapshot` / `deleteSnapshot`. |

Lookup order for every evaluation:

```
get(feature, default, target)
  └─ cache.get ──hit──▶ serve (refresh in background if expired)
       │ miss/error
       ▼
     store.get ──hit──▶ backfill cache, serve (refresh in background if expired)
       │ miss/error
       ▼
     refreshOnMiss = blocking   ──▶ await Chargebee → store.set → cache.set → serve
     refreshOnMiss = background ──▶ start fetch, return default (status "pending")
```

Two TTLs matter:

- `cacheTtlMs`: when the cache entry disappears. A vanished entry is a plain miss.
- `snapshotTtlMs` (5 min): sets `snapshot.expiresAt`. Past it, the snapshot is served stale and refreshed in the background.

## Mode toggle: `refreshOnMiss`

Changes only the cold-miss path. `blocking` (default) waits on Chargebee; `background` returns defaults with status `pending`.

## Scenarios

### 1a. Cold miss, blocking
No snapshot in cache or store (e.g. first login).
1. User → App: request; target from session.
2. App → SDK: `get(featureId, default, target)`.
3. SDK → Cache: miss.
4. SDK → Store: miss.
5. SDK → Chargebee: fetch, awaited. Concurrent requests share it.
6. Chargebee → SDK: paginated entitlements → snapshot.
7. SDK → Store: persist. Failure propagates → `error` / `unavailable`.
8. SDK → Cache: populate. Failure swallowed.
9. SDK → App: `granted`, `source: "api"`.
10. App → User: rendered.

### 1b. Cold miss, background
Steps 1–4 as above, then:
5. SDK → App: default, `status: "pending"` (`SnapshotPendingError` caught).
6. App → User: rendered with defaults.
7–10. Background fetch → store → cache. Skipped within `refreshBackoffMs` after a failure.

### 2. Store hit, cache miss
1–3 as above. Store returns the snapshot; SDK backfills the cache; returns `source: "store"`. If the row is expired, it is still served and a background refresh starts.

### 3. Cache hit
Cache returns a fresh snapshot; `source: "cache"`. Store and Chargebee untouched.

### 4. Expired snapshot (stale-while-revalidate)
Cache returns a snapshot past `expiresAt`. It is served (`source: "cache"`) and a deduplicated background refresh updates store and cache. Happens when `cacheTtlMs ≥ snapshotTtlMs` or an expired store row was backfilled. With defaults the cache entry vanishes first, so this path is usually reached through the store (scenario 2 + background refresh).

### 5. Outage
Cache read throws → `onError(cache-read)`, treated as a miss. Store returns an expired row; cache backfill fails silently. Refresh fails → `onError(refresh)`, retries suppressed for 10s. Expired store snapshot served. With no store row: blocking → `error` / `unavailable`; background → `pending`. `get()` never throws.

### 6. Webhook refresh
Chargebee → Webhook → `refreshSnapshot(target)`: cancel in-flight request refreshes, evict cache, fetch, persist to store and cache, `onSnapshotRefreshed({ trigger: "explicit" })`. A memory cache evicts only in the handling process. Alternatives: `writeSnapshot` (snapshot built from the payload), `deleteSnapshot` (clears cache and store).

### 7. Browser relay
Browser → `GET /api/entitlements` → `createEntitlementsRelayHandler` → `getRelaySnapshot(target)` (same resolution chain) → `expiresAt` rewritten to `now + relayTtlMs` (60s) → `200` with `Cache-Control: no-store`. Guards: non-GET 405, identity query params 400, no session 401, failure 502. The browser evaluates synchronously: no snapshot → `pending`; expired → `stale` plus one background refetch.

## Per-feature outcomes (any scenario)

| Status | When | Value |
|---|---|---|
| `granted` | Enabled, parses as the default's type | Entitlement value |
| `disabled` | Disabled, or entitlement `expiresAt` passed | Default |
| `error` / `not-found` | Feature absent from snapshot | Default |
| `error` / `type-mismatch` | Value doesn't parse as the default's type | Default |
| `error` / `invalid-target` | Neither or both of `customerId` / `subscriptionId` | Default |
| `error` / `unavailable` | Snapshot couldn't be loaded | Default |
| `pending` | Background cold miss, or browser not loaded | Default |
| `stale` | Browser snapshot expired, refetching | Default |
