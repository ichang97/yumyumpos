FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:local

FROM node:22-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/yumyum-pos.sqlite \
    LOCAL_AUTH_MODE=off \
    LOCAL_USER_EMAIL=local@yumyum.pos \
    LOCAL_USER_ADMIN=true \
    TRUST_PROXY=true
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/worker ./worker
COPY --from=build /app/local ./local
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/dist/client ./dist/client

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "local/server.js"]
