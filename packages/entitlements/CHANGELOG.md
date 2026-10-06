# Changelog

## Unreleased

- No OpenFeature vocabulary remains in this package; `@chargebee/openfeature`
  maps the results instead. `EntitlementResolution` is now
  `EntitlementDetails`: `{ value, status, source?, entitlement?, error? }`.
  `status` is `granted`, `disabled`, `pending`, `stale`, or `error`;
  `error.code` is `not-found`, `type-mismatch`, `invalid-target`, or
  `unavailable`. `reason`, `variant`, `flagMetadata`, `errorCode`, and
  `errorMessage` are removed, along with the OpenFeature error codes.
- Both clients and `Feature` share one method pair: `get` returns the value,
  `getDetails` the `EntitlementDetails`. `getValue` is removed.
- `ChargebeeEntitlementsWebClient` is now `ChargebeeEntitlements` from
  `/web` (options: `ChargebeeEntitlementsOptions`), mirroring the server
  client. Callbacks match the server's names: `onStale` is
  `onSnapshotExpired`, `onConfigurationChanged(flagsChanged)` is
  `onSnapshotRefreshed({ snapshot, changedFeatureIds })`, and
  `onError(message)` is `onError(error, { operation })`.
- Added `entitlements.for(target)` on the server client. It returns a
  `ScopedEntitlements` with the browser client's shape (`get`, `getDetails`,
  `feature`, no target) that shares the parent's cache and store.
- `EntitlementsClient` is now `TargetedEntitlementsClient` (server, target
  required) or `ScopedEntitlementsClient` (browser client or
  `entitlements.for(target)`, no target). `Feature` takes the client type as
  a second type parameter, so a server client's `feature(...)` requires
  `get(target)` and a scoped client's requires `get()`. A standalone feature
  still accepts either; a missing target on the server returns
  `invalid-target`.
- The relay stamps `expiresAt` as now plus `relayTtlMs`, even when the server
  serves an expired stored snapshot. Browsers no longer refetch on every
  evaluation during a Chargebee outage.
- The web client discards relay responses started before `reset()` or
  `close()`, and reports a still-expired snapshot through
  `onSnapshotExpired` once.
- The package no longer ships `dist/src`, `dist/test`, or `.tsbuildinfo`.
- A feature is declared with an ID and a mandatory, concrete default value:
  `new Feature<number>("licensed-seats", 0)` (or `entitlements.feature(...)`,
  which binds it to a client). `feature.get(target)` returns the typed value
  and `feature.getDetails(target)` the full resolution. Standalone features
  resolve against the client passed to `setDefaultEntitlements(client)`.
  Because the default value is always concrete, its runtime type is the single
  source for how an entitlement is parsed — there is no `type` option, no
  inference from Chargebee's `featureType`, and no `FeatureValueType`.
  Function-valued defaults are gone with them; await `get` and branch on the
  result if a fallback needs to come from a database.
- A target is `{ customerId }` or `{ subscriptionId }`. The `mode` field,
  `ChargebeeEvaluationMode`, the `defaultMode` option, and the
  `chargebeeCustomerId`/`chargebeeSubscriptionId`/`chargebeeEvaluationMode`
  context keys (with `CHARGEBEE_CONTEXT_KEYS` and `getTargetFromContext`) are
  removed. Passing both identifiers, or neither, is rejected rather than
  resolved by precedence. Other properties on the object are ignored, so a
  request context can be passed straight through.
- `getValue(featureId, defaultValue, target)` is the only evaluation method on
  both clients; `getBooleanValue`, `getStringValue`, `getNumberValue`, and
  `getObjectValue` are removed, as are the standalone
  `resolveBooleanEntitlement`/`resolveString...`/`resolveNumber...`/`resolveObject...`
  helpers.
- `logger` moved from every method signature to `ChargebeeEntitlementsOptions`.
- Snapshots no longer carry `targetMode`; `createEntitlementsSnapshot` takes
  `(entitlements, ttlMs, now?)` and now lives on `/server`, alongside the
  `writeSnapshot` call that consumes it. `serializeEntitlementsSnapshot` and
  `parseSerializedEntitlementsSnapshot` moved to `/cache`, next to the
  `EntitlementsStorage` interface that needs them.
- Trimmed the export surface substantially. The root entry point is now
  `Feature`, `setDefaultEntitlements`, and the five types that appear in their
  signatures; `Feature` has exactly one import path instead of being
  re-exported from `/server` as well. Removed `defineFeatures`,
  `getDefaultEntitlements`, `toResolutionDetails` (now internal to
  `@chargebee/openfeature`), the `advanced.resolveTarget` option, and the
  `FeatureOptions`, `FeatureGetOptions`, `FeatureDefaultValue`,
  `FeatureDefaultResolver`, `FeatureDefaultContext`, `FeatureDefinition`,
  `FeatureCatalog`, `FeatureTarget`, `EntitlementsEvaluator`,
  `EvaluationContextLike`, `RefreshOnMiss`, `SnapshotOperation`,
  `EntitlementsSnapshotResult`, `EntitlementsRelayHandler`,
  `EntitlementsRelaySource`, and `ChargebeeEntitlementsClient` types.
- Replaced `zod` dependency in snapshot parsing with zero-dependency lightweight validation.
- Deduplicated internal evaluation, storage, and loader normalization logic.
- Initial extraction of the framework-agnostic Chargebee entitlements client
  from `@chargebee/openfeature`. `ChargebeeEntitlements` (server) and
  `ChargebeeEntitlementsWebClient` (web) can now be used directly, without an
  OpenFeature SDK. `@chargebee/openfeature` is now a thin adapter over this
  package.
- The shared snapshot/cache/relay modules (`shared`, `cache`, `server`,
  `web`, `nextjs`) moved here unchanged from `@chargebee/openfeature`. See
  that package's changelog for their history prior to the split.
- The default cache-key namespace changed from `chargebee:openfeature:v1` to
  `chargebee:entitlements:v1`. Pass `cacheNamespace` explicitly if you need to
  keep reading previously cached keys.
