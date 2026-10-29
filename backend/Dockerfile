FROM node:24-bookworm-slim

WORKDIR /app/backend
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Install the locked Linux dependencies instead of copying Windows node_modules.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node app/ ./app/
COPY --chown=node:node workers/ ./workers/
COPY --chown=node:node server.js ./server.js
COPY --chown=node:node scripts/migrate_postgres_schema.js scripts/postgres_status.js ./scripts/
COPY --chown=node:node scripts/container_health.js ./scripts/

# Writable runtime directories will be shared with Engine in the Compose step.
RUN mkdir -p data/book-audio public/audio/samples public/audio/generated \
    && chown -R node:node data public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
