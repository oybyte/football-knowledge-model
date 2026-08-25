# ============================================================================
# odds-edge 后端服务 Dockerfile
# 多阶段构建：install → production
# ============================================================================

# ---- 构建阶段 ----
FROM node:22-alpine AS builder
WORKDIR /app

# 仅复制 package.json 以利用 Docker 缓存层
COPY server/package.json ./
RUN npm install --omit=dev

# ---- 运行阶段 ----
FROM node:22-alpine
WORKDIR /app

# 安装 ca-certificates 用于 HTTPS 请求
RUN apk add --no-cache ca-certificates tzdata

# 复制构建产物
COPY --from=builder /app/node_modules ./node_modules
COPY server/ .

# 数据目录
RUN mkdir -p /app/data

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('node:http').get('http://localhost:${OE_PORT:-3000}/api/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

EXPOSE 3000

ENV NODE_ENV=production
ENV OE_DB_PATH=/app/data/odds-edge.db

CMD ["node", "bin/start.js"]