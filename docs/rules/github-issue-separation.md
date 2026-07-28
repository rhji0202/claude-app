# 절대 규칙: "이슈"와 "GitHub Issue"는 완전히 별개 기능이다

> 상태: **절대 규칙 (ABSOLUTE RULE)** · 제정일: 2026-07-28
> 이 문서의 규칙은 협상 대상이 아니다. 변경하려면 이 문서를 먼저 고쳐야 한다.

## 배경

사이드바에 이슈를 다루는 두 메뉴가 나란히 있다.

| | **이슈** | **GitHub Issue** |
|---|---|---|
| 경로 | `/issues` | `/github-issues` |
| 목적 | Claude 에이전트가 처리할 **작업 큐** | GitHub 저장소 이슈 **뷰어/에디터** |
| 데이터 원천 | 자체 DB (`IssueTask` 테이블) | GitHub REST API (실시간, 저장 안 함) |
| 핵심 동작 | 이슈 가져오기 → 에이전트 실행 → 결과/PR | 열림·닫힘 조회, 라벨·담당자·코멘트 편집 |
| 상태 값 | `queued/running/done/error/...` | GitHub의 `open` / `closed` |
| API 네임스페이스 | `/api/issues/**` | `/api/gh-issues/**` |

둘 다 GitHub 이슈를 다룬다는 이유로 한쪽 코드를 다른 쪽에 끌어다 쓰면, 한 기능의
요구사항 변경이 다른 기능을 조용히 망가뜨린다. 그래서 **의도적으로 중복을 감수하고
분리**한다.

## 규칙

1. **코드 공유 금지.** 두 기능은 서로의 서비스·컨트롤러·DTO·타입·React 컴포넌트를
   import하지 않는다. 필요하면 각자 자기 쪽에 복제한다.
   - `IssuesService` ↔ `GhIssuesService` 상호 호출 금지
   - `GithubService`(에이전트 큐용) ↔ `GhApiClient`(뷰어용) 통합 금지
   - `IssueTask` 타입 ↔ `GhIssue` 타입 겸용 금지
2. **DB 금지.** GitHub Issue 뷰어는 GitHub 데이터를 어떤 테이블에도 저장하지
   않는다. 항상 실시간 프록시다. 캐시가 필요해지면 뷰어 전용 저장소를 새로 만든다.
3. **에이전트 금지.** GitHub Issue 뷰어에서는 에이전트를 실행하지 않고, 큐에
   이슈를 넣지 않으며, 사용량(`UsageRecord`)을 기록하지 않는다.
4. **네임스페이스 고정.** 백엔드는 `gh-issues`, 프론트는 `/github-issues`,
   공유 타입은 `Gh` 접두사(`GhIssue`, `GhLabel`, `GhComment`, …)를 쓴다.
   기존 `issues` 네임스페이스에 뷰어용 라우트를 추가하지 않는다.
5. **UI 통합 금지.** 두 메뉴를 하나로 합치거나, 한쪽 화면에 다른 쪽 탭을 넣지
   않는다. 사이드바에서도 별도 항목으로 유지한다.
6. **공용 인프라는 예외.** 인증(`@CurrentUser`), 프로젝트 권한
   (`ProjectsService.assertAccess` / `assertCanEdit`), 암호화(`CryptoService`),
   Prisma, 디자인 시스템 컴포넌트(`Button`, `Dialog`, `Markdown` 등)는 앱 전체
   공용이므로 양쪽에서 써도 된다. **이슈 도메인 로직만** 분리 대상이다.

## 파일 소유권

```
에이전트 이슈 큐 (건드리지 말 것 — 뷰어 작업 시)
  apps/api/src/issues/**
  apps/api/src/github/github.service.ts
  apps/web/src/app/issues/**
  packages/shared/src/types.ts 의 IssueTask 계열

GitHub Issue 뷰어 (건드리지 말 것 — 큐 작업 시)
  apps/api/src/gh-issues/**
  apps/web/src/app/github-issues/**
  packages/shared/src/gh-issues.ts
```

## 뷰어 쪽 구현 메모

- 프로젝트 탭은 `gitRepo`가 설정된 접근 가능 프로젝트만 노출한다
  (`GET /api/gh-issues/projects`).
- GitHub 토큰은 프로젝트 자격증명(`gitTokenEnc`)을 복호화해 호출마다 주입한다.
  토큰이 없으면 읽기는 공개 저장소 한정으로 동작하고, 쓰기는 400으로 막는다.
- 권한: 읽기 = `assertAccess`(viewer 포함), 쓰기 = `assertCanEdit`(viewer 제외).
- 목록은 기본이 **열린 이슈**이며 닫힘/전체로 전환할 수 있다. 검색어가 있으면
  Search API, 없으면 저장소 issues API를 쓴다(둘 다 PR 제외).
- 열림/닫힘 개수는 Search API 집계이며, rate limit 등으로 실패하면 `counts: null`로
  내려가고 화면에서는 숫자만 생략된다(목록 자체는 정상 동작).
- 본문·코멘트의 GitHub 첨부 이미지는 인증이 필요해 브라우저가 직접 열 수 없다.
  응답에 `imageMap`(원본 URL → 서명된 프록시 경로)을 실어 보내고,
  `GET /api/gh-issues/:projectId/image`가 프로젝트 토큰으로 대신 받아 스트리밍한다.
  `<img>`는 Authorization 헤더를 못 실으므로 이 라우트만 `@Public`이며, 접근 통제는
  HMAC 서명(projectId·URL·1시간 만료)이 담당한다. 프록시 대상은 `github.com`과
  `*.githubusercontent.com`의 https URL로 제한한다(SSRF 방지).
  이 서명 로직은 `/uploads`(UploadsService)와 같은 발상이지만 **코드는 공유하지
  않는다** — `GhImageProxyService`가 전용 구현이다.

## 위반 시

리뷰에서 되돌린다. "코드가 비슷하니 합치자"는 이 규칙을 뒤집는 근거가 되지 않는다.
