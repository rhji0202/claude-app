# Claude 관리 시스템 (모노레포)

[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) 기반 관리 시스템.
GitHub 이슈 처리 · 크론 · 프로젝트 · 스킬 · MCP 서버를 관리하며, 프로젝트별로
git 연결과 API 키를 분리 보관하고 팀 공유/공유 링크를 지원합니다.

## 아키텍처 (pnpm 워크스페이스)

```
claude-app/
├─ apps/
│  ├─ api/      NestJS 백엔드 (REST API, 에이전트 실행, 크론, 인증)
│  │  ├─ prisma/schema.prisma   PostgreSQL 데이터 모델
│  │  └─ src/
│  │     ├─ config/    환경변수 검증 (zod)
│  │     ├─ prisma/    PrismaModule / PrismaService
│  │     ├─ crypto/    자격증명 필드 암호화 (AES-256-GCM)
│  │     └─ …          Phase 2+: projects/issues/cron/skills/mcp/agent/auth/share
│  └─ web/      Next.js 15 프론트엔드 (대시보드 UI)
└─ packages/
   └─ shared/   API·UI 공유 도메인 타입 (타입 전용)
```

- **백엔드**: NestJS + Prisma + PostgreSQL
- **프론트엔드**: Next.js 15 (App Router) + React 19
- **인증/보안**: JWT 인증, 프로젝트별 자격증명 AES-256-GCM 암호화 저장
- **공유**: 팀원 멀티유저 공유 + 공유 링크(테스터 수동 이슈 등록)

## 개발 시작

```bash
pnpm install

# API 환경변수
cp apps/api/.env.example apps/api/.env
# ENCRYPTION_KEY 생성: openssl rand -base64 32
# DATABASE_URL, JWT_SECRET 설정

# DB 마이그레이션 (PostgreSQL 필요)
pnpm --filter @claude-app/api prisma:migrate

# 개발 서버 (api + web 동시)
pnpm dev
#   web → http://localhost:3000
#   api → http://localhost:3001/api
```

개별 실행:

```bash
pnpm dev:api    # NestJS (watch)
pnpm dev:web    # Next.js
```

## 진행 상황 (단계별 마이그레이션)

- [x] **1. 기반**: 모노레포, NestJS 스켈레톤, Prisma 스키마, 공유 타입, 암호화/설정 모듈
- [ ] **2. 핵심 CRUD**: projects/issues/cron/skills/mcp 모듈, 프로젝트별 git·API키, M:N 조인
- [ ] **3. 에이전트·크론·큐**: 프로젝트별 키 주입 실행, 동적 크론(SchedulerRegistry), 동시성 큐
- [ ] **4. 인증·공유**: JWT 인증, 팀 공유, 공유 링크(테스터 이슈 등록)
- [ ] **5. 프론트 연동**: Next.js를 NestJS API 소비로 전환

> 현재 `apps/web`에는 마이그레이션 이전의 Next.js 풀스택 코드(API 라우트 포함)가
> 그대로 남아 있으며, 5단계에서 NestJS API 소비로 전환하면서 정리됩니다.

## 보안 메모

- 프로젝트별 `ANTHROPIC_API_KEY` / GitHub 토큰은 AES-256-GCM으로 암호화해 저장하며,
  API 응답에는 값 대신 보유 여부만 내려줍니다.
- 에이전트 실행 시 복호화한 키를 SDK `env` 옵션으로 주입합니다 (프로세스 전역 키 미사용).
