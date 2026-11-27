# 号工具（HaoKit）运行镜像：只装生产依赖，以非 root 用户运行
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public

USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
