# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
#  Mehrstufiger Build.
#
#  Das fertige Abbild enthält weder Quellcode noch Entwicklungsabhängigkeiten —
#  nur den Standalone-Build von Next.js. Das hält es klein und verkleinert die
#  Angriffsfläche auf einem Server, der aus dem Netz erreichbar ist.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS deps
WORKDIR /app
# better-sqlite3 wird nativ übersetzt, dafür braucht es eine Toolchain.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci


FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Beim Bauen wird kein echtes Geheimnis gebraucht; zur Laufzeit schon.
ENV SESSION_SECRET="build-time-platzhalter-wird-zur-laufzeit-ersetzt"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build


FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/data/finance.db

# Nicht als root laufen lassen.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# better-sqlite3 ist nativ und wird vom Standalone-Bündel nicht mitgenommen.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Die Datenbank liegt im Volume, nicht im Abbild — sonst wäre sie bei jedem
# Update weg.
RUN mkdir -p /data && chown nextjs:nodejs /data
VOLUME /data

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
