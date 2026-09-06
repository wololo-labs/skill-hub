# Multi-stage build, so `docker compose up` works from a clean clone with
# nothing installed on the host but Docker.
#
# Stage one builds the frontend bundle and packs the backend; stage two
# installs production dependencies only and runs it. Native modules are
# compiled in the stage that runs them, so the two never disagree.

FROM node:22-bookworm AS build

WORKDIR /app
ENV CI=true

# The yarn release and the lockfile first, so a dependency install is only
# redone when dependencies actually change.
COPY .yarn ./.yarn
COPY .yarnrc.yml package.json yarn.lock backstage.json ./
COPY packages/app/package.json packages/app/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY plugins/skill-hub/package.json plugins/skill-hub/package.json
COPY plugins/skill-hub-backend/package.json plugins/skill-hub-backend/package.json
COPY plugins/skill-hub-common/package.json plugins/skill-hub-common/package.json
RUN yarn install --immutable

COPY . .
RUN yarn tsc && yarn build:backend

FROM node:22-bookworm-slim AS runtime

# better-sqlite3 is still a dependency of the backend bundle even though this
# deployment runs Postgres, so its build inputs have to be present.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libsqlite3-dev python3 g++ make \
    && rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/.yarn ./.yarn
COPY --from=build --chown=node:node /app/.yarnrc.yml /app/backstage.json ./
COPY --from=build --chown=node:node /app/yarn.lock /app/package.json ./
COPY --from=build --chown=node:node /app/packages/backend/dist/skeleton.tar.gz ./
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz
RUN yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"

COPY --from=build --chown=node:node /app/examples ./examples
COPY --from=build --chown=node:node /app/packages/backend/dist/bundle.tar.gz ./
COPY --chown=node:node app-config.yaml app-config.production.yaml ./
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

EXPOSE 7007
CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
