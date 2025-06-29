# chargebee-init monorepo

`chargebee-init` is a CLI to help integrate Chargebee services with your existing app. It supports popular Node.js frameworks and libraries and takes an opinionated approach to setting up _just_ enough boilerplate so you can focus on how your business domain uses Chargebee services.

The following Chargebee features are currently supported:

* One time checkout
* Subscription checkout
* Manage payment methods
* Open customer portal
* Log incoming webhook events

**Note: The CLI does not provide additional UI components. It uses the Chargebee Node SDK to invoke the relevant APIs from your backend service**


## Framework support

The CLI integrates the following backend-frameworks


| Framework | Version | Notes |
|-----------|---------|-------|
| Next.js   | 15   | Only App Router supported |
| Express   | 5 | |


## Requirements

* Node.js >= 20
* Existing app should be TypeScript based


## Quick start

Run `npx chargebee-init` in your existing app directory.


## Installation

The CLI can be invoked directly via `npx` or an equivalent script runner:

```
# Node.js
npx chargebee-init

# Bun
bunx chargebee-init
```

It can also be installed globally as a NPM package:

```
npm install -g chargebee-init
```
