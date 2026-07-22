# Next.js 프론트엔드 (apps/web) — standalone 산출물 기반 슬림 이미지
# 저장소 루트를 빌드 컨텍스트로 사용:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api .

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# ---- 빌드 단계 ----
FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
# NEXT_PUBLIC_* 는 빌드 시점에 정적으로 박힌다.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @claude-app/web build

# ---- 런타임 단계 ----
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
# standalone 산출물(모노레포 구조 유지) + 정적 자산
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
