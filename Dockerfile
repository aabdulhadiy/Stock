# --- Dependencies -----------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Build ------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Runtime ----------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# Standalone server bundle + static assets.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# PDF fonts. `outputFileTracingIncludes` should already have placed these in the
# standalone output, but they are copied explicitly too: without them, Russian
# and Uzbek PDF exports silently lose their Cyrillic (§13), and that is not a
# failure worth leaving to a tracing heuristic.
COPY --from=builder --chown=nextjs:nodejs /app/assets/fonts ./assets/fonts

# Migration SQL + boot scripts. Migrations run via drizzle-orm's migrator
# (plain Node) on container start — no drizzle-kit needed at runtime. Copy the
# full drizzle-orm + postgres packages so the migrator submodule resolves.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder /app/node_modules/postgres ./node_modules/postgres

# Uploads live on a mounted volume (§16.1) and must be writable by the app user.
RUN mkdir -p /app/var/uploads && chown -R nextjs:nodejs /app/var

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV UPLOAD_DIR=/app/var/uploads

# The container is healthy once the app answers; compose uses this to order
# startup and to restart a wedged process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["sh", "scripts/docker-entrypoint.sh"]
