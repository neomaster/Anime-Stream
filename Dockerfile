FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY config.js server.js ./
COPY services ./services
COPY public ./public

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "server.js"]