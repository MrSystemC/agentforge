FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173

WORKDIR /app
COPY package.json package-lock.json ./
COPY config.mjs security.mjs storage.mjs server.mjs app.js index.html styles.css manifest.webmanifest sw.js ./

RUN groupadd --system agentforge \
    && useradd --system --gid agentforge --home-dir /app --shell /usr/sbin/nologin agentforge \
    && npm ci --omit=dev --ignore-scripts \
    && mkdir -p /app/data \
    && chown -R agentforge:agentforge /app

USER agentforge
VOLUME ["/app/data"]
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
