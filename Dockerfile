# ── build stage ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ── runtime stage ───────────────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATABASE_PATH=/app/data/bot.sqlite
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data
USER node
CMD ["node", "dist/index.js"]
