FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    LAPSE_DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
RUN mkdir -p /data && chown node:node /data

VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/health || exit 1

USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.ts"]
