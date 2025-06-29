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
pre-commit install
```

### Running locally

To test the CLI and framework adapters locally, we first build the required packages and then link them so that `npm` can recognise the locally available versions. This causes minimal disruption to the dev workflow as well.

#### Building required packages

```
# Build all the required packages from this repo
pnpm build

# Watch for changes and compile
pnpm watch

# Link packages
pnpm link:all
```

Once the packages are built and installed, running `npm|pnpm|bun` install _should_ use the local version of the package. The `chargebee-init` CLI should now be available in the global bin directory (if configured correctly), or can be invoked via `npx chargebee-init`. Run `$(npm config get prefix)/bin` and ensure that directory exists in your `PATH`. Alternatively, you can invoke the script via `node /path/to/js-framework-adapters/packages/cli/dist/cli.js`.

#### Running chargebee-init

`chargebee-init` expects an existing app which uses one of the supported frameworks. Run the following commands in the app directory:

```
# Your existing app
cd nextjs-app

# Running chargebee-init that was linked previously using "pnpm link:all"
npx chargebee-init

# Install the required packages that was linked previously using "pnpm link:all"
npm link @chargebee/nextjs --save
```

The last step is to pass the required secrets to the API client. Depending on your app and framework, this can be as simple as adding them to the `.env` file, or by passing the secrets to replace the `process.env.*` variables at build time.

```
CHARGEBEE_SITE=
CHARGEBEE_API_KEY=
CHARGEBEE_WEBHOOK_AUTH="username:password"
```

Congrats! Your app should now be ready to use Chargebee services. Start your server, have a look at the generated code and make the required changes. Happy hacking :-)

#### Linking/Unlinking packages

To verify if the packages are linked as expected, run `npm ls -g --link` which should output something like this:

```
/opt/homebrew/lib
├── @chargebee/nextjs@0.1.0 -> ./../../../Users/srinath/projects/js-framework-adapters/packages/nextjs
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
│   ├── core (private, packaged as part of build)
│   │   ├── dist
│   │   └── package.json
│   │       ├── devDependencies
│   │       |   ├── chargebee
│   │       │   └── zod
│   ├── nextjs (@chargebee/nextjs)
│   │   ├── dist
|   |   |   ├── *.js
|   |   |   ├── *.d.ts
|   |   |   ├── core/*.js (copied from packages/core/dist)
│   │   └── package.json
│   │       ├── dependencies
│   │       |   ├── chargebee
│   │       │   └── zod
│   │       └── peerDependencies
│   │           └── next
│   └── express (@chargebee/express)
│       ├── dist
|       |   ├── *.js
|       |   ├── *.d.ts
|       |   ├── core/*.js (copied from packages/core/dist)
│       └── package.json
│           ├── dependencies
│           |   ├── chargebee
│           │   └── zod
│           └── peerDependencies
│               └── express
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

* The templates exist within the target framework directory to provide type checking and IDE autocompletion during development. However, they are excluded from the published package as they are required only as a part of the cli to be copied into the target app directory. For example, the `nextjs/charge/page.ts` depends on Next.js and other custom types, which are direct requirements for `@chargebee/nextjs`, but not for the CLI.

* Framework specific packages (e.g. `@chargebee/nextjs`) will have the only framework (`next`) defined as a peerDependency. All other runtime dependencies (e.g `chargebee`, `zod`) are defined as direct dependencies


#### Dependency tree

When initialised, the `chargebee-init` CLI adds the required dependencies to the target app. An exmple of the dependency tree is shown below for a Next.js app:

```
nextjs-app
└── dependencies
    ├── next
    └── @chargebee/nextjs
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
