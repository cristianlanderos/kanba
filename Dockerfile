# ---- Dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- Builder ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Production ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
# The database schema, and the script that brings a database up to it.
COPY --from=builder /app/db ./db
COPY --from=builder /app/supabase/migrations ./supabase/migrations
COPY --from=builder /app/scripts/migrate.js /app/scripts/set-password.js ./scripts/
# Uploaded images. Mount a folder or a volume here to keep them.
ENV KANBA_UPLOADS=/data/uploads
RUN mkdir -p /data/uploads
VOLUME /data/uploads
EXPOSE 3000
# The schema first, so a new or older database is ready before the first request.
CMD ["sh", "-c", "node scripts/migrate.js && npm start"]
