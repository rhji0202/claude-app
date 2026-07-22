# NestJS 백엔드 (apps/api) — 상시 실행 컨테이너
# 저장소 루트를 빌드 컨텍스트로 사용:  docker build -f apps/api/Dockerfile .

FROM node:22-slim AS base
# prisma 엔진에 openssl 필요
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---- 빌드 단계 ----
FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @claude-app/api prisma:generate
RUN pnpm --filter @claude-app/api build

# ---- 런타임 단계 ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
WORKDIR /app/apps/api
EXPOSE 3001
# 시작 시 마이그레이션 적용 후 서버 기동
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main"]
