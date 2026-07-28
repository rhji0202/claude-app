# CLAUDE.md

이 저장소에서 작업할 때 반드시 지켜야 할 규약. 구조·실행 방법은 [README.md](./README.md) 참고.

## 절대 규칙 (ABSOLUTE RULES)

아래 규칙은 협상 대상이 아니다. 어기려면 해당 규칙 문서를 먼저 고쳐야 한다.

### 1. "이슈"(`/issues`)와 "GitHub Issue"(`/github-issues`)는 완전히 별개 기능이다

- **이슈** (`/issues`, `/api/issues/**`, `apps/api/src/issues/**`)
  → Claude 에이전트가 처리할 **작업 큐**. 자체 DB(`IssueTask`)에 저장하고 실행한다.
- **GitHub Issue** (`/github-issues`, `/api/gh-issues/**`, `apps/api/src/gh-issues/**`)
  → GitHub 저장소 이슈 **뷰어/에디터**. 실시간 프록시이며 DB에 저장하지 않고
  에이전트를 실행하지 않는다.

두 기능은 서비스·컨트롤러·DTO·타입·React 컴포넌트를 **서로 import하지 않는다.**
둘 다 GitHub 이슈를 다룬다는 이유로 통합·재사용하지 말 것. 필요하면 각자 복제한다.
공용 인프라(인증·권한·암호화·Prisma·디자인 시스템 컴포넌트)만 예외다.

전체 규칙: **[docs/rules/github-issue-separation.md](./docs/rules/github-issue-separation.md)**

## 작업 규약

- 주석·커밋 메시지·UI 문구는 한국어. 기존 파일의 톤과 밀도를 따른다.
- 공유 타입은 `packages/shared`에 두고, API·web은 `@claude-app/shared`에서 소비한다.
  shared는 dist를 소비하므로 타입체크 전에 빌드가 필요하다(각 앱의 `pretypecheck`가 처리).
- 검증: `pnpm --filter @claude-app/api typecheck`, `pnpm --filter @claude-app/web typecheck`,
  `pnpm --filter @claude-app/api test`.
- 시크릿(Claude OAuth 토큰, 프로젝트 GitHub 토큰)은 AES-256-GCM으로 저장하고
  API 응답에는 보유 여부만 내린다. 값을 그대로 반환하는 코드를 추가하지 말 것.
