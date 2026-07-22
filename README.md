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
- [x] **2. 핵심 CRUD**: projects/issues/cron/skills/mcp 모듈, 프로젝트별 git·API키(암호화), 크론식 검증, 수동 이슈 등록
- [x] **3. 에이전트·크론·큐**: 프로젝트별 키 주입 실행(SDK env), 동적 크론(SchedulerRegistry, 부팅 복원), 동시성 큐(p-limit), 프로젝트별 GitHub 연동(가져오기·실행·코멘트)
- [x] **4. 인증·공유**: JWT 인증(전역 가드+@Public), 프로젝트 소유권·팀 공유(viewer/editor), 공유 링크(read/issue_report — 테스터 로그인 없이 이슈 등록)
- [x] **5. 프론트 연동**: Next.js를 NestJS API 소비로 전환, 로그인·프로젝트 관리(공유·링크·스킬/MCP 연결·실행)·이슈·크론 UI, 공개 공유 페이지(테스터 이슈 등록)

> `apps/web`은 이제 자체 API 라우트 없이 NestJS API만 소비합니다(`src/lib/api.ts`).
> 인증은 JWT를 localStorage에 보관하며, 공유 링크 페이지 `/share/[token]`은 로그인 없이 접근합니다.

## 인증 · 공유 API

```
POST /api/auth/register           회원가입 → { accessToken, user }
POST /api/auth/login              로그인
GET  /api/auth/me                 (Bearer) 내 정보
# 이하 Bearer 토큰 필요
POST   /api/projects/:id/shares          팀원 공유 { email, role: viewer|editor } (소유자)
GET    /api/projects/:id/shares
DELETE /api/projects/:id/shares/:userId
POST   /api/projects/:id/share-links     공유 링크 발급 { scope: read|issue_report }
GET    /api/projects/:id/share-links
DELETE /api/share-links/:linkId
# 공개(비로그인) — 공유 링크 토큰으로 접근
GET  /api/public/share/:token            읽기 전용 프로젝트 뷰(시크릿 제외)
POST /api/public/share/:token/issues     테스터 수동 이슈 등록 (scope=issue_report)
```

모든 리소스 라우트는 전역 JWT 가드로 보호되며, 프로젝트 접근은 소유자 또는
공유받은 사용자만 가능합니다(viewer는 읽기, editor는 편집, owner는 삭제·공유 관리).

## 배포

배포 방법은 [DEPLOY.md](./DEPLOY.md) 참고:
- **선택 A**: 프론트 → Vercel(`apps/web`), 백엔드 → Render/Railway 등 상시 호스트(`render.yaml`/`apps/api/Dockerfile`)
- **선택 B**: 한 호스트에 전부 → `docker compose up` (`docker-compose.yml`)

> Vercel은 서버리스라 백엔드(상시 크론 + 에이전트 서브프로세스)를 실행할 수 없어,
> Vercel 사용 시 백엔드는 별도 상시 호스트가 필요합니다.

## 보안 메모

- 프로젝트별 `ANTHROPIC_API_KEY` / GitHub 토큰은 AES-256-GCM으로 암호화해 저장하며,
  API 응답에는 값 대신 보유 여부만 내려줍니다.
- 에이전트 실행 시 복호화한 키를 SDK `env` 옵션으로 주입합니다 (프로세스 전역 키 미사용).
