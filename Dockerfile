FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
COPY . .
# The build context excludes Git metadata; keep install lifecycle scripts active.
RUN VP_GIT_HOOKS=0 pnpm install --frozen-lockfile && pnpm build
RUN VP_GIT_HOOKS=0 pnpm --filter @repo/api deploy --prod --legacy /out

FROM node:22-bookworm-slim AS runtime
ARG SERVICE_VERSION=development
ENV OTEL_RESOURCE_ATTRIBUTES="service.version=${SERVICE_VERSION}"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 STATIC_ROOT=/app/website HOME_MEDIA_DIRECTORY=/app/data/media
WORKDIR /app
COPY --from=build --chown=node:node /out /app
COPY --from=build --chown=node:node /app/apps/website/dist /app/website
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
