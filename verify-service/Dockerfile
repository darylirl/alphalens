FROM node:22-slim
WORKDIR /app
COPY package.json index.mjs enqueue.mjs backfill.mjs scorer.mjs prebuild.mjs ./
COPY lib ./lib
COPY specs ./specs
USER node
CMD ["node", "index.mjs"]
