# Claude 관리 시스템

[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk) 기반의 관리 대시보드입니다.
GitHub 이슈 처리, 크론 작업, 프로젝트, 스킬, MCP 서버를 한 곳에서 관리합니다.

> **현재 상태: 뼈대(skeleton)** — 전체 아키텍처와 5개 모듈의 기본 CRUD·실행 흐름이 동작합니다.
> 데이터는 `.data/`에 JSON으로 저장됩니다(운영 시 `src/lib/store.ts`만 교체하면 DB로 전환 가능).

## 기술 스택

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **@anthropic-ai/claude-agent-sdk** — 에이전트 실행
- **node-cron** / **cron-parser** — 스케줄링
- 파일 기반 JSON 스토어 (뼈대 단계 영속 계층)

## 아키텍처

```
src/
├── app/
│   ├── page.tsx              대시보드 (요약)
│   ├── projects/             프로젝트 관리 UI
│   ├── issues/               GitHub 이슈 처리 UI
│   ├── cron/                 크론 관리 UI
│   ├── skills/               스킬 관리 UI
│   ├── mcp/                  MCP 서버 관리 UI
│   └── api/                  각 모듈 REST 엔드포인트
│       ├── projects, skills, mcp   (CRUD)
│       ├── issues/[id]/run          (에이전트 실행)
│       ├── cron/[id]/run            (즉시 실행)
│       └── agent                    (임의 프롬프트 실행)
├── components/
│   ├── Sidebar.tsx           네비게이션
│   └── CrudPanel.tsx         설정 기반 재사용 CRUD 패널
└── lib/
    ├── types.ts              도메인 모델
    ├── store.ts              JSON 스토어 (CRUD)
    ├── api.ts                API 라우트 공통 헬퍼
    ├── agent/runner.ts       Agent SDK query() 래퍼
    ├── modules/issues.ts     이슈 실행 로직
    └── cron/
        ├── scheduler.ts      크론 검증·다음 실행·즉시 실행
        └── worker.ts         상시 스케줄러 워커 프로세스
```

## 핵심 개념

- **프로젝트**가 에이전트 실행의 컨텍스트입니다. 작업 디렉터리(`cwd`), 모델, 허용 도구,
  연결할 MCP 서버/스킬을 정의합니다.
- **이슈/크론** 작업은 프로젝트를 참조해 실행됩니다.
- **스킬**은 활성화되어 프로젝트에 연결되면 에이전트 시스템 프롬프트에 주입됩니다.
- **MCP 서버**는 프로젝트에 연결되면 SDK `mcpServers` 옵션으로 전달됩니다.

## 시작하기

```bash
npm install

# 인증 설정
cp .env.example .env
# .env 에 ANTHROPIC_API_KEY 입력

npm run dev            # http://localhost:3000
```

크론 작업을 상시 실행하려면 별도 워커를 함께 띄웁니다:

```bash
npm run scheduler
```

## 다음 단계 (뼈대 이후 확장 예정)

- GitHub API/MCP 실연동으로 이슈 자동 fetch, PR 생성
- 에이전트 실행 로그 실시간 스트리밍(SSE) UI
- 이슈/크론 실행 비동기 큐 처리 (현재는 동기 실행)
- 사용자 인증 및 권한, 감사 로그
- 스토어를 Postgres/SQLite로 이전
