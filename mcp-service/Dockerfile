FROM node:22-slim
WORKDIR /app
COPY package.json index.mjs smoke.mjs server.json ./
COPY lib ./lib
USER node
CMD ["node", "index.mjs"]
