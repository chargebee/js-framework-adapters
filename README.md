# chargebee/js-framework-adapters

A CLI to help integrate Chargebee with your existing app. Just run `npx chargebee-init` to get started!

## Development

### Requirements

* Node.js >= 20
* pnpm
* pre-commit

Install Homebrew and run the following commands to get all dependencies:

```
brew install node@22 pre-commit
npm i -g pnpm
pnpm setup
git clone https://github.com/chargebee/js-framework-adapters
pnpm i
```

### Running locally

To test the CLI and framework adapters locally, we first build the required packages and then link them so that `npm` can recognise the locally available versions. This causes minimal disruption to the dev workflow as well.

```
# Build all the required packages from root
pnpm build

# Watch for changes and compile
pnpm watch

# Link packages
pnpm link:all
```

Once the packages are built and installed, running `npm|pnpm|bun` install _should_ use the local version of the package. The `chargebee-init` CLI should now be available in the global bin directory (if configured correctly), or can be invoked via `npx chargebee-init`

#### Linking/Unlinking packages

To verify if the packages are linked as expected, run `npm ls -g --link` which should output something like this:

```
/opt/homebrew/lib
├── @chargebee/nextjs@0.1.0 -> ./../../../Users/srinath/projects/js-framework-adapters/packages/nextjs
├── chargebee-init-core@ -> ./../../../Users/srinath/projects/js-framework-adapters/packages/core
└── chargebee-init@ -> ./../../../Users/srinath/projects/js-framework-adapters/packages/cli
```

To unlink packages, run `npm unlink --global --no-save <package name>`


### Layout

```
chargebee/js-framework-adapters/
├── packages/
│   ├── cli (chargebee-init)
│   │   ├── bin
│   │   │   └── cli
│   │   ├── src
│   │   └── dist
│   │       ├── *.js
│   │       └── templates
│   │           ├── nextjs (copied from nextjs/templates)
│   │           └── express (copied from express/templates)
│   ├── core (chargebee-init-core)
│   │   ├── dist
│   │   └── package.json
│   │       ├── dependencies
│   │       |   ├── chargebee
│   │       │   ├── qs
│   │       │   └── zod
│   ├── nextjs (@chargebee/nextjs)
│   │   ├── dist
│   │   └── package.json
│   │       ├── dependencies
│   │       │   └── chargebee-init-core
│   │       └── peerDependencies
│   │           └── next
│   └── express (@chargebee/express)
│       ├── dist
│       └── package.json
│           ├── dependencies
│           │   └── chargebee-init-core
│           └── peerDependencies
│               └── express
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

* The templates exist within the target framework directory to provide type checking and IDE autocompletion during development. However, they are excluded from the published package as they are required only as a part of the cli to be copied into the target app directory. For example, the `nextjs/charge/page.ts` depends on Next.js and other custom types, which are direct requirements for `@chargebee/nextjs`, but not for the CLI.

* Framework specific packages (e.g. `@chargebee/nextjs`) will have the only framework (`next`) defined as a peerDependency. All other runtime dependencies (e.g `chargebee`, `chargebee-init-core`) are defined as direct dependencies


#### Dependency tree

When initialised, the `chargebee-init` CLI adds the required dependencies to the target app. An exmple of the dependency tree is shown below for a Next.js app:

```
nextjs-app
└── dependencies
    ├── next
    └── @chargebee/nextjs
        ├── dependencies
        │   └── chargebee-init-core
        │       └── dependencies
        │           ├── chargebee-node
        │           ├── qs
        │           └── zod
        └── peerDependencies
            └── next
```

### Compatibility

Runtimes: Node.js, Deno, bun

Frameworks: Next.js, Express, Nuxt.js, Hono

* Generate routes, controllers and glue code for checkout, portal and webhook
* Run a standardized test suite with mock data against your app server
* Validate API inputs with strong types and runtime validation with Zod/ArkType

User authentication: Better Auth, Clerk, Auth.js

ORMs: Prisma, Drizzle
