# Entitlements benchmark runner. Build from the repo root:
#
#   docker build --platform linux/arm64 \
#     -f packages/entitlements/bench/Dockerfile -t entitlements-bench .
#
# Set REDIS_URL and POSTGRES_URL to point at real services (see infra/).
FROM node:22-slim

RUN corepack enable

WORKDIR /app

# Manifests first, so the install layer is cached across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/entitlements/package.json packages/entitlements/

RUN pnpm install --frozen-lockfile --filter @chargebee/entitlements...

COPY packages/entitlements packages/entitlements

WORKDIR /app/packages/entitlements

CMD ["pnpm", "bench"]
