# SightLoop local stack — Daemon (+ Admin / fixture via compose command overrides)
# If docker.io pulls stall (common on some CN networks), pre-pull via a mirror then tag:
#   docker pull docker.m.daocloud.io/library/node:22-bookworm-slim
#   docker tag docker.m.daocloud.io/library/node:22-bookworm-slim node:22-bookworm-slim
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .nvmrc ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build \
      --filter=@sightloop/daemon... \
      --filter=@sightloop/admin... \
      --filter=@sightloop/fixture-react... \
      --filter=@sightloop/extension...

RUN mkdir -p /app/data /workspace

ENV SIGHTLOOP_HOST=0.0.0.0 \
    SIGHTLOOP_PORT=7420 \
    SIGHTLOOP_DB_PATH=./data/projects.sqlite \
    MARKUP_WORKSPACE=./data/markup-workspace \
    SIGHTLOOP_LOCK_DIR=./data/locks \
    SIGHTLOOP_ALLOWED_ROOTS=/workspace,/app \
    NODE_ENV=production

EXPOSE 7420 5173 5175

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=8 \
  CMD curl -fsS http://127.0.0.1:7420/health || exit 1

CMD ["pnpm", "--filter", "@sightloop/daemon", "start"]
