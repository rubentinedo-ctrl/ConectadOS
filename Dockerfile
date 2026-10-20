# syntax=docker/dockerfile:1
FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS dependencies
WORKDIR /build
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --include=dev
FROM dependencies AS build
COPY . .
RUN mkdir -p public && npm run typecheck && npm test && npm run build
FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 CONECTADOS_ROOT=/state
COPY --from=build --chown=node:node /build/.next/standalone ./
COPY --from=build --chown=node:node /build/.next/static ./.next/static
COPY --from=build --chown=node:node /build/public ./public
COPY --from=build --chown=node:node /build/lib ./lib
COPY --from=build --chown=node:node /build/deploy/observer/lib ./deploy/observer/lib
COPY --from=build --chown=node:node /build/scripts ./scripts
COPY --from=build --chown=node:node /build/LICENSE ./LICENSE
COPY --from=build --chown=node:node /build/docs/licenses ./licenses
RUN mkdir -p /state/.data /state/.keys /state/.backups && chown -R node:node /state && chmod 700 /state /state/.data /state/.keys /state/.backups
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node","scripts/container-health.mjs"]
CMD ["node","scripts/container-launch.mjs"]
