# Poly-Drill 运行镜像：纯 Node 服务（发静态页 + 账号/记录 API），无需多阶段构建
FROM node:22-alpine

ENV NODE_ENV=production \
    TZ=Asia/Shanghai

WORKDIR /app

# 先装依赖，利用层缓存：只改代码时不必重装
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend ./backend
COPY frontend ./frontend

# 数据目录：容器内由 node(uid 1000) 写入，宿主挂载目录也要 1000 可写
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV PORT=3000 \
    DATA_DIR=/app/data

EXPOSE 3000

# 服务本身有 /api/health，用 Node 自带 fetch 探活，不额外装 curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/server.js"]
