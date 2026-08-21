# Changelog

## Unreleased

- Added a concise feature API. Declare a feature with
  `new Feature(id, { type, defaultValue })` (or `entitlements.feature(...)`) and
  fetch its typed value with a single `feature.get(target)`; `getDetails`
  returns the full resolution. Standalone features resolve against the client
  passed to `setDefaultEntitlements(client)`. The existing
  `getBooleanValue`/`getNumberValue`/... methods are unchanged.
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
