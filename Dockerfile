FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# --- Production image ---
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ ./dist/
COPY data/sample.tsv ./data/sample.tsv

# Persistent volume mount point for SQLite DB
RUN mkdir -p /data
ENV DB_PATH=/data/jeopardy.db
ENV PORT=3000
ENV LOG_LEVEL=info
ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js", "serve"]
