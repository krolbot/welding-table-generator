# syntax=docker/dockerfile:1.7
FROM node:26.7.0-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

RUN npm prune --omit=dev

FROM node:26.7.0-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019
WORKDIR /app
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Welding Table Generator" \
      org.opencontainers.image.description="Server-calculated parametric welding table generator" \
      org.opencontainers.image.source="https://github.com/krolbot/welding-table-generator" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.licenses="MIT"
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz | grep -qx ok
EXPOSE 80
CMD ["node", "server-dist/server.js"]
