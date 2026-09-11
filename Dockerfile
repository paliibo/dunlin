# syntax=docker/dockerfile:1

###############################################################################
# Dependencies — cached on the lockfile alone, so source edits don't reinstall.
###############################################################################
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

###############################################################################
# Build — compile TypeScript, then drop the dev dependencies.
###############################################################################
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

###############################################################################
# Runtime — non-root, production dependencies only, health-checked.
# The same image runs as the API (default) or the worker (DUNLIN_ROLE=worker).
###############################################################################
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN groupadd --system --gid 1001 dunlin && useradd --system --uid 1001 --gid dunlin dunlin
COPY --from=build --chown=dunlin:dunlin /app/node_modules ./node_modules
COPY --from=build --chown=dunlin:dunlin /app/dist ./dist
COPY --chown=dunlin:dunlin package.json ./

USER dunlin
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
