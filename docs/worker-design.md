# 이슈 워커 시스템 설계 문서

> 상태: **설계 초안 (검증 반영)** · 작성 2026-07-23
> 목적: 이슈 실행을 큐/워커로 분리하고, 병렬 실행·결정 대기(사람 개입)·GitHub triage를 단계적으로 도입한다.
> 검증: 코드베이스 다각도 조사로 리스크 S1~S3(심각)·M1~M3(중요) 발견 → 3·5·9·10절에 반영.
> 결정 반영: "같은 프로젝트 이슈도 동시 실행" → per-run worktree 격리(11절) + 시스템 관리 clone(12절, 옵션 B).

---

## 1. 배경 · 현재 구조의 문제

현재 이슈 실행은 **단일 API 프로세스 안에서 in-memory 백그라운드**로 돌아간다.

- `IssuesService.startRun()` → `void this.executeRun(...)` — HTTP 요청 프로세스에서 fire-and-forget 실행 (`apps/api/src/issues/issues.service.ts:345`)
- 동시성은 `AgentService`의 `p-limit`(기본 3)이라는 **in-memory 세마포어**로만 제한 (`apps/api/src/agent/agent.service.ts:71`)
- 크론도 별도 워커가 아니라 `@nestjs/schedule`로 같은 프로세스에서 `agent.run` 직접 호출 (`apps/api/src/cron/cron-registry.service.ts`)
- 배포는 Render **단일 web 서비스** + Postgres. Redis·워커 컨테이너·큐 라이브러리 **전무**

### 이 구조에서 실제로 발생한 문제

1. **서버 재시작 시 실행 중단** — in-memory 실행이라 프로세스가 죽으면 상태 갱신 주체가 사라져 `RUNNING`으로 영구히 남는다(고아 레코드). → 임시로 `onModuleInit` 정리 + `INTERRUPTED` 상태로 완화함.
2. **재시도 없음** — 실패/중단된 이슈를 자동으로 다시 시도하지 않는다.
3. **병렬 실행 오케스트레이션 없음** — 배치 실행 진입점이 없다. 사용자가 이슈를 하나씩 수동 `run` 해야 하고, "우연히" p-limit 범위 내에서만 동시 실행된다.
4. **사람 개입(결정 대기) 흐름 없음** — 워커가 판단이 필요할 때 멈추고 사람이 이어받는 개념이 없다.

---

## 2. 목표

| # | 목표 | 현재 | 필요 |
|---|------|------|------|
| 1 | 큐/워커 분리 (재시작 견고 + 재시도) | in-memory | DB 기반 큐 + 폴링 워커 |
| 2 | 여러 이슈 병렬 실행 | 수동 단건 | 큐가 QUEUED를 동시 N개 pick-up + 일괄 큐 UI |
| 3 | GitHub triage (분류→라벨→PR) | 읽기+코멘트만 | 라벨 쓰기·PR 생성·구조화 분류 |
| 4 | 결정 대기 + 메모로 이어서 진행 | resume 골격만 | `NEEDS_DECISION` 상태 + 메모 모델 + 재개 API |

---

## 3. 아키텍처 결정: DB 기반 큐 (Redis/BullMQ 미채택)

### 두 가지 선택지

| | **A. DB 기반 큐 (채택)** | B. BullMQ (Redis) |
|---|---|---|
| 신규 인프라 | 없음 (기존 Postgres 재사용) | Redis 인스턴스 신설 |
| 재시도·지연·우선순위 | 직접 구현 (간단) | 내장 |
| 워커 분리 | 같은 프로세스 폴러 or 별도 `worker.ts` | 별도 워커 컨테이너 권장 |
| 복잡도 | 낮음 | 중간 |
| 적합성 | 소규모·단일 인스턴스 | 대규모·다중 워커 |

### 채택: **A (DB 기반 큐)**

근거:
- 이 프로젝트는 Render 단일 서비스 + Postgres. Redis가 전혀 없고 이슈 처리량도 크지 않다.
- `IssueTask.status`에 이미 `QUEUED`가 있어 "폴링해서 집어 실행"하는 워커를 얹기 자연스럽다.
- 이미 있는 `onModuleInit` 고아 정리 로직과 맞물린다.
- Redis 도입은 배포/운영 부담(관리형 Redis 비용 or 컨테이너)을 늘린다. 규모가 커지면 그때 B로 이관.

> ⚠️ **단일 인스턴스 전제**: DB 폴링 워커는 다중 인스턴스로 스케일아웃하면 같은 이슈를 중복 pick-up 할 위험이 있다. 이를 막으려면 `SELECT ... FOR UPDATE SKIP LOCKED`(원자적 클레임)가 필요하다. Render 단일 서비스인 현재는 문제없으나, 스케일아웃 시 반드시 원자적 클레임을 구현해야 한다. (아래 5.1 참고)

> ⚠️ **워커는 API와 동일 프로세스(in-process)로 유지한다** — 별도 워커 컨테이너로 분리하지 않는다. 이유: 현재 `onModuleInit` 고아 정리가 "실행이 in-process"라는 전제에 의존하므로, 프로세스를 분리하면 실행 중인 이슈를 잘못 INTERRUPTED로 마킹한다(리스크 S1). DB 폴링 워커는 프로세스 분리 없이도 성립한다. 크론도 이미 in-process다.

> ⚠️ **같은 프로젝트 이슈도 동시 실행 → per-run worktree 격리 필수** — `project.cwd`가 프로젝트당 고정이라, 격리 없이 같은 프로젝트 이슈를 병렬 실행하면 git 충돌이 난다(리스크 S2). 요구사항이 "같은 프로젝트도 동시 실행"이므로 실행마다 독립 작업 디렉터리(git worktree)를 만들어 격리한다. 상세는 **12절**.

---

## 4. 데이터 모델 변경

### 4.1 IssueStatus enum 확장

```prisma
enum IssueStatus {
  QUEUED
  RUNNING
  DONE
  ERROR
  INTERRUPTED
  NEEDS_DECISION   // 신규: 워커가 사람 판단을 기다리는 상태
}
```

큐 클레임의 원자성을 위해 필드 추가(선택, 스케일아웃 대비):

```prisma
model IssueTask {
  // ... 기존 필드 ...
  attempts    Int       @default(0)   // 재시도 횟수
  claimedAt   DateTime?               // 워커가 집은 시각 (stale 클레임 회수용)
  lockedBy    String?                 // 워커 인스턴스 id (다중 워커 대비)
}
```

### 4.2 IssueNote 모델 신설 (메모/이력)

현재 IssueTask에는 스칼라 필드만 있고 이력/메모 자식 모델이 없다. 사람 메모와 워커 진행 이력을 누적 저장할 모델을 추가한다.

```prisma
enum IssueNoteAuthor {
  HUMAN      // 사람이 남긴 메모/지시
  AGENT      // 에이전트 진행 결과·질문
  SYSTEM     // 상태 전이 로그
}

model IssueNote {
  id        String          @id @default(uuid())
  issueId   String
  issue     IssueTask       @relation(fields: [issueId], references: [id], onDelete: Cascade)
  author    IssueNoteAuthor
  content   String
  createdAt DateTime        @default(now())

  @@index([issueId])
}
```

IssueTask에 관계 추가: `notes IssueNote[]`

> 이렇게 하면 "결정 대기 → 사람이 메모 남김 → 워커가 메모를 포함해 재개"가 가능해진다.
> `prompt`는 현재 **덮어쓰기**라 누적이 안 되지만, IssueNote는 누적되므로 재개 시 프롬프트에 히스토리로 주입한다.

---

## 5. 컴포넌트 설계

### 5.1 IssueWorkerService (신규)

DB 기반 큐 워커. `@nestjs/schedule`의 인터벌로 주기적으로 QUEUED를 폴링한다.

```
onModuleInit:
  - (기존) RUNNING 고아 → INTERRUPTED 정리   ← 이미 구현됨

@Interval(pollMs)  또는  SchedulerRegistry 기반 tick:
  1. 현재 RUNNING 개수 조회 → free = AGENT_CONCURRENCY - runningCount (여유 슬롯)
  2. free > 0 이면 QUEUED 이슈를 최대 free개 클레임한다.
       - 같은 프로젝트 이슈도 동시 클레임 OK (worktree로 격리하므로 — 11·12절)
       - (단일 인스턴스면) 일반 트랜잭션 UPDATE로 충분
       - (스케일아웃 시) FOR UPDATE SKIP LOCKED 원자적 클레임 필요
  3. 클레임한 각 이슈마다:
       - 관리 clone 확인/준비 (12절: 없으면 clone, 있으면 fetch)
       - per-run worktree 생성 (11절) → 그 경로를 cwd override로 executeRun에 전달
       - executeRun 실행 (AgentService.run 경유, opts.cwd = worktree 경로)
       - 종료(성공/실패/중단) 후 finally에서 worktree 정리
  4. stale 클레임 회수: RUNNING인데 claimedAt이 너무 오래됨 → INTERRUPTED
     (in-process 단일 워커면 onModuleInit 정리로 충분, 프로세스 분리 시 이 로직 필수)

동시성은 한 곳으로 통일한다(리스크 M1): 워커가 "클레임 수 ≤ free"를 보장하고,
AgentService.p-limit은 초과 방지 안전망으로만 둔다. DB 카운트와 p-limit을 이중
게이트로 쓰지 않는다.

재시도:
  - ERROR/INTERRUPTED 이면서 attempts < MAX_RETRY 인 이슈를 QUEUED로 되돌림
    (지수 백오프: 다음 시도까지 대기 시간 = base * 2^attempts)
```

핵심: **`executeRun`은 그대로 재사용**한다. 바뀌는 건 "누가 언제 executeRun을 호출하는가" — 지금은 HTTP 요청이 직접, 앞으로는 워커가 큐에서.

### 5.2 실행 종료 → 상태 결정 (executeRun 확장)

현재 `executeRun`은 `res.status`/`res.interrupted`로 DONE/ERROR/INTERRUPTED를 정한다. 여기에 **needs-decision 감지**를 추가한다.

에이전트가 "판단 필요"를 표현하는 방법 두 가지:
- **(권장) 구조화 출력**: 시스템 프롬프트로 "결론을 내릴 수 없거나 사람 결정이 필요하면 결과 끝에 `DECISION_NEEDED: <질문>`을 출력하라"고 지시 → executeRun이 파싱
- 또는 별도 결과 스키마(향후 SDK 도구 활용)

감지되면 → status = `NEEDS_DECISION`, 질문을 IssueNote(AGENT)로 저장.

### 5.3 재개 흐름 (결정 대기 → 이어서 진행)

```
1. 이슈가 NEEDS_DECISION 상태
2. 사람이 메모 추가:  POST /issues/:id/notes { content }
     → IssueNote(HUMAN) 저장
3. 사람이 재개:  POST /issues/:id/resume
     → status = QUEUED (attempts 유지)
     → 워커가 pick-up
4. buildPrompt가 IssueNote 히스토리(사람 메모 포함)를 프롬프트에 주입
     → resume: task.sessionId 로 세션 이어받기 (이미 구현됨)
```

> resume 골격은 이미 있다(`executeRun`의 `resume: task.sessionId`, `agent.service.ts`). 단 **이미지가 있으면 resume이 무시**되는 제약이 있으니(새 세션), 재개 시나리오에서 이미지 처리 방식을 확정해야 한다.

### 5.4 GitHub triage 워커 (Phase 3)

가장 큰 신규 작업. 현재 `GithubService`는 읽기 + 코멘트만 가능하다. 필요한 추가:

**GithubService 확장:**
- `setLabels(repo, number, labels, token)` — 라벨 쓰기 (현재 없음)
- `createPullRequest(repo, head, base, title, body, token)` — PR 생성 (현재 없음)
- 브랜치/커밋/푸시: GithubService(REST 래퍼)에 넣기보다, **에이전트가 cwd에서 `git`/`gh` CLI를 직접 실행**하는 편이 단순 (env에 이미 GITHUB_TOKEN 주입됨)

**분류 카테고리** (참고: 이 환경의 `/triage-issue-worker` 스킬과 정합):
- `auto-fix` — 자동 수정 가능 → 브랜치+PR
- `needs-decision` — 사람 결정 필요 → NEEDS_DECISION 상태 (5.3 흐름)
- `needs-info` — 정보 부족 → 이슈에 질문 코멘트
- `question` — 단순 질문 → 답변 코멘트

triage는 워커가 이슈를 실행할 때 분류 단계를 먼저 거치도록 시스템 프롬프트/스킬로 구성한다.

---

## 6. API 변경

| 메서드 | 경로 | 설명 | 상태 |
|--------|------|------|------|
| POST | `/issues/:id/run` | 단건 실행 (→ 큐에 넣기로 변경) | 기존 |
| POST | `/issues/batch-run` | 여러 이슈 일괄 큐 `{ ids: string[] }` | **신규** |
| POST | `/issues/:id/notes` | 메모 추가 `{ content }` | **신규** |
| GET | `/issues/:id/notes` | 메모/이력 조회 | **신규** |
| POST | `/issues/:id/resume` | 결정 대기 → 재개 | **신규** |

> `POST /issues/:id/run`은 이제 "즉시 실행"이 아니라 "QUEUED로 만들기"가 되고, 실제 실행은 워커가 담당한다. 응답 UX가 바뀌므로 프론트도 조정 필요.

---

## 7. 프론트엔드 변경

- **일괄 실행**: 이슈 목록에 다중 선택(체크박스) → "선택 N개 실행" 버튼 (현재는 행별 단건 링크만)
- **결정 대기 UI**: `NEEDS_DECISION` 상태 배지 + 클릭 시 팝업에서 에이전트 질문 표시 + 메모 입력 + "재개" 버튼
- **메모/이력 타임라인**: 이슈 상세에 IssueNote 목록 (사람/에이전트/시스템 구분)
- **상태 라벨/색상**: `NEEDS_DECISION` → "결정 대기"(주황/파랑)
- 재사용: 이미 있는 상태 팝업(`IssueStatusCell`), StatusBadge variant 패턴 확장

---

## 8. 환경변수 추가

```
# 워커 폴링 주기 (ms)
ISSUE_WORKER_POLL_MS=5000
# 이슈 실행 최대 재시도
ISSUE_MAX_RETRY=2
# stale 클레임 회수 임계(ms) — RUNNING인데 이 시간 넘게 갱신 없으면 회수
ISSUE_STALE_MS=600000
# per-run worktree 루트 (미설정 시 apps/api/worktrees)
ISSUE_WORKTREE_ROOT=
# 시스템 관리 clone 루트 (미설정 시 apps/api/repos) — UPLOADS_DIR와 분리 필수(정적 노출 방지)
REPOS_DIR=
```

(기존 `AGENT_CONCURRENCY`가 동시 실행 슬롯 수로 그대로 쓰임)

---

## 9. 단계별 실행 계획

의존 관계상 아래 순서가 자연스럽다. 각 Phase는 독립 배포 가능.

### Phase 0 — 마이그레이션 이력 정합화 (선행 필수, 리스크 S3) ✅ 완료(로컬)
- [x] 현재 로컬 DB 실제 스키마 확인 — `IssueStatus`에 `INTERRUPTED` 있음, `ClaudeAccount`/`ChatSession`/`ChatMessage` 존재, `_prisma_migrations` 테이블 **없음**(전부 db push로 생성됨). init 마이그레이션 SQL이 현 스키마와 불일치(구 `model`/`allowedTools`/`anthropicApiKeyEnc` 컬럼 포함).
- [x] baseline 재설정: init 마이그레이션 SQL을 `prisma migrate diff --from-empty --to-schema-datamodel`로 **현재 스키마 기준 재생성** → `prisma migrate resolve --applied 20260722043712_init`로 로컬 DB에 적용 처리. `migrate status` = "up to date".
- [x] `Dockerfile`의 `migrate deploy`는 init이 현 스키마와 일치하므로 신규 DB에 정상 적용됨.
- [ ] **프로덕션 DB 정합화 (배포 시 1회 필수)**: 프로덕션도 db push로 만들어졌다면 `_prisma_migrations`가 없어 `migrate deploy`가 이미 존재하는 테이블을 CREATE하려다 실패한다. 배포 전 프로덕션에서 **`prisma migrate resolve --applied 20260722043712_init`를 1회 수동 실행**해 baseline 처리해야 한다(그 후 `migrate deploy`가 후속 마이그레이션만 적용). 신규(빈) 프로덕션 DB면 이 단계 불필요.
- [ ] 이후 스키마 변경은 db push가 아니라 마이그레이션으로 관리

### Phase 1 — 시스템 clone + worktree 격리 + DB 큐/워커 (목표 1+2) ✅ 완료
- [x] **12절 clone 관리 서비스**(옵션 B): `RepoManagerService`(`src/repo/repo-manager.service.ts`) — `gitRepo` → `<REPOS_DIR>/<projectId>` 인증 clone/fetch, 프로젝트별 락 직렬화, update 시 invalidate·삭제 시 정리. 토큰은 `git -c http.extraHeader`로만 주입(`src/repo/git.util.ts`) → `.git/config`에 미기록(검증).
- [x] **12.5 cwd 처리 결정**: **실행 근거에서 전면 제거**. `RunAgentOptions.cwd`는 필수, `execute/executeStream`은 `opts.cwd`만 사용(project.cwd 미참조). 이슈·크론=worktree, 채팅·프로젝트 임의 실행=관리 clone base(`prepareForProject`). `create-project.dto`의 cwd는 선택으로 완화.
- [x] IssueTask에 `attempts`/`claimedAt`/`lockedBy` + `@@index([status])` 추가 (마이그레이션 `20260723030635_issue_worker_queue_fields`)
- [x] `RunAgentOptions`에 `cwd` 추가 + `execute/executeStream`에서 사용
- [x] worktree 생성/정리 로직: `WorktreeService`(`src/repo/worktree.service.ts`) — 관리 clone base에서 `git worktree add -B issue/<id> ... origin/<branch>`, 프로젝트별 직렬화, `remove --force`+`prune`, 부팅 시 `pruneOrphans`. Windows 경로 posix 정규화(검증).
- [x] `IssueWorkerService` 신설(**in-process**, S1): `@nestjs/schedule` interval 폴링 + 슬롯 계산 + 낙관적 클레임 + fetch/worktree/executeClaimed + finally 정리 + 지수 백오프 재시도 + stale 회수
- [x] 동시성 통일(M1): 워커가 `free = AGENT_CONCURRENCY - RUNNING`만큼만 클레임, p-limit은 안전망
- [x] `startRun`을 "QUEUED로 만들기"로 변경, `executeClaimed`를 워커가 호출 (crypto/uploads/repos/worktrees 주입)
- [x] `POST /issues/batch-run` + 프론트 다중 선택 UI (CrudPanel에 `batchActions` 옵트인 확장)
- [x] **프론트 폴링**(M2): CrudPanel `pollWhile` 옵트인 — RUNNING/QUEUED 있을 때 4초 refetch
- [x] 단위 테스트: `issue-worker.service.spec.ts`(8) + `issues.service.spec.ts`(4) — 슬롯/재시도/stale/클레임/gitRepo 가드/worktree 정리. 전체 62 통과.
- [x] 검증: git worktree add/remove/prune·clone→worktree→fetch 로컬 E2E 통과(토큰 미기록 확인), Nest 부팅 시 전체 DI 그래프 정상.
- [ ] **런타임 실행 검증(사용자 환경 필요)**: 실제 gitRepo 프로젝트로 같은 프로젝트 이슈 여러 개 큐 → 동시 N개 병렬 실행 → 서버 재시작 후 이어짐 → worktree 정리. (로컬 프로젝트는 gitRepo 지정 필요)

### Phase 2 — 결정 대기 + 메모/재개 (목표 4)
- [ ] `IssueStatus.NEEDS_DECISION` 추가 (db push)
- [ ] `IssueNote` 모델 신설 + 관계
- [ ] executeRun에 needs-decision 감지 (구조화 출력 파싱)
- [ ] `buildPrompt`가 IssueNote 히스토리 주입
- [ ] `/issues/:id/notes`, `/issues/:id/resume` API
- [ ] 프론트: 결정 대기 팝업 + 메모 입력 + 재개 버튼 + 이력 타임라인
- [ ] 검증: 빈 이슈("test") → NEEDS_DECISION → 메모 남기고 재개 → 이어서 진행

### Phase 3 — GitHub triage 워커 (목표 3)
- [ ] GithubService에 `setLabels`, `createPullRequest` 추가
- [ ] 에이전트가 cwd에서 git/gh CLI로 브랜치·커밋·PR (권한/토큰 확인)
- [ ] triage 분류 시스템 프롬프트/스킬 (auto-fix/needs-decision/needs-info/question)
- [ ] 분류 결과 → 라벨 적용 / PR 생성 / 코멘트 / NEEDS_DECISION 전이
- [ ] 검증: 실제 GitHub 이슈로 분류 → 라벨/PR 생성 확인

---

## 10. 리스크 · 열린 질문

### 🔴 심각 — 설계 가정을 흔드는 문제 (검증으로 발견)

**S1. 워커 프로세스 분리 ↔ 고아 정리(onModuleInit) 충돌**
- 현재 `onModuleInit`의 `RUNNING → INTERRUPTED` 정리는 **"실행이 in-process"라는 전제**에 의존한다(`issues.service.ts:46-48` 주석). "서버가 죽으면 실행도 죽는다"가 참이라 RUNNING을 안전하게 청소할 수 있다.
- 워커를 **별도 프로세스로 분리하면 이 전제가 깨진다.** API가 재시작돼도 워커는 살아서 이슈를 실행 중일 수 있는데, API의 `onModuleInit`이 그걸 **잘못 INTERRUPTED로 마킹**한다.
- **대응 (택1):**
  - (권장) **워커를 API와 같은 프로세스에 유지**한다(별도 컨테이너로 분리하지 않음). 채택한 "DB 기반 폴링 워커"는 프로세스 분리 없이도 성립하며, 이 방식이면 고아 정리 전제가 유지된다. → **9절 계획을 "in-process 워커"로 명확히 고정.**
  - 프로세스를 분리한다면, 고아 정리를 `onModuleInit`이 아니라 **워커의 stale-claim 회수 로직(claimedAt 기반)으로 일원화**하고, API는 RUNNING을 건드리지 않는다.

**S2. 동일 `project.cwd` 병렬 실행 시 git 충돌** ← 목표 2·3의 최대 장애물
- `project.cwd`는 프로젝트당 고정된 자유 문자열 디렉터리다(`schema.prisma:138`). 실행은 그 cwd에서 `bypassPermissions`로 실제 파일 편집·git·bash를 수행한다(`agent.service.ts:423`). per-run 격리(worktree/임시 clone)가 **코드에 전혀 없다**(grep 0건).
- **같은 프로젝트의 여러 이슈를 병렬 실행하면 동일 디렉터리에서 다중 에이전트가 동시에 브랜치 전환·커밋 → 충돌·오염.** 특히 Phase 3(triage가 브랜치+PR)에서 치명적.
- **결정: "같은 프로젝트 여러 이슈도 동시 실행"이 요구사항이므로 → per-run git worktree 격리를 채택**한다(단순 프로젝트 직렬화로는 요구를 못 채운다). 상세 설계는 **12절**을 참조.

**S3. 마이그레이션 드리프트 — 프로덕션 스키마 불일치**
- 프로덕션 배포는 `prisma migrate deploy`(`Dockerfile:27`)인데, migrations 폴더엔 **init 하나뿐**이고 그 init에는 `INTERRUPTED` enum·`ClaudeAccount`·`ChatSession` 등 **후속 변경이 전부 없다.** 그동안 로컬은 `db push`로만 반영해 왔다.
- 즉 **프로덕션 DB에는 `INTERRUPTED`조차 없을 수 있고**, 이 상태에서 워커용 스키마 변경(enum·IssueNote 관계)을 또 db push로 넣으면 이력이 더 벌어진다.
- **대응:** 워커 작업 착수 전에 **마이그레이션 이력을 정합화**한다. init 이후 현재 schema까지를 담는 후속 마이그레이션을 생성(`prisma migrate dev`)하거나, 현재 스키마를 baseline으로 재설정(`migrate resolve --applied`)한다. 이 정합화를 **Phase 0**로 둔다.

### 🟠 중요

**M1. p-limit ↔ DB 카운트 이중 제한**
- 동시성 제어가 지금은 `p-limit`(=AGENT_CONCURRENCY, 기본 3) **하나뿐**이고, DB의 RUNNING 카운트는 게이트로 쓰이지 않는다(표시·정리용).
- 워커가 "RUNNING < N일 때 클레임"을 추가하면 **두 게이트가 겹쳐**, DB상 RUNNING 수와 실제 활성 서브프로세스 수가 불일치할 수 있다(p-limit 큐에 쌓인 것도 이미 RUNNING 마킹됨).
- **대응:** 동시성 제어를 **한 곳으로 통일**한다. 워커가 클레임 개수 자체를 슬롯(AGENT_CONCURRENCY)에 맞춰 조절하고, `AgentService`는 `p-limit`을 그대로 두되 워커는 그 한도를 초과 클레임하지 않는다. 즉 "클레임 수 ≤ 슬롯"을 워커가 보장 → p-limit은 안전망 역할만.

**M2. 프론트 폴링/실시간 갱신 부재** ← UX 필수
- 이슈 목록은 자동 새로고침이 **전혀 없다**(폴링·SWR·SSE 없음). 갱신은 `reloadSignal` 수동 트리거뿐(`CrudPanel.tsx:128`).
- 워커가 백그라운드로 상태를 바꿔도 **사용자가 새로고침 없이는 못 본다.** 워커 도입의 UX 전제가 무너진다.
- **대응 (택1):** (a) 이슈 페이지에 **폴링**(예: RUNNING/QUEUED가 있을 때만 5초 간격 refetch) 추가 — 가장 간단. (b) `GET /issues/stream` SSE 구독 — chat의 `streamPost` SSE 파싱 로직 재활용 가능하나 서버 엔드포인트 신설 필요. → **Phase 1에서 폴링(a)부터.**

**M3. 진행 관측 부재**
- 이슈 실행은 시작/종료 **경계만** 기록한다. 실행 중 SDK의 tool/text 이벤트는 채팅 경로(`executeStream`)에서만 SSE로 나가고, 이슈 경로(`execute`)는 최종 텍스트만 수집한다.
- 워커가 수 분~수십 분 도는 동안 **진행률·현재 도구를 볼 방법이 없다.** 디버깅·사용자 신뢰에 불리.
- **대응:** 이슈 실행도 `runStream` 기반으로 바꿔 진행 이벤트를 IssueNote(AGENT) 또는 로그로 남기는 것을 Phase 2~3에서 검토. Phase 1에서는 최소한 상태 전이 로깅 강화.

### 🟡 기타 (기존 항목 + 검증 보강)

1. **다중 워커 스케일아웃** — DB 폴링 워커는 단일 인스턴스 전제. 스케일아웃하면 `FOR UPDATE SKIP LOCKED` 원자적 클레임이 필수인데, 코드베이스에 raw SQL(`$queryRaw`/`$executeRaw`) 선례가 0건이라 처음부터 만들어야 한다. (in-process 단일 워커면 당장은 불필요)
2. **이미지 + resume 제약** — 재개 시 이미지가 있으면 세션 resume이 무시된다(`agent.service.ts:431`, 새 세션). 재개 UX에서 이미지 처리 방식 확정 필요.
3. **needs-decision 감지 신뢰성** — 구조화 출력 파싱은 에이전트가 규약을 안 지키면 실패. SDK 도구/스키마 기반이 더 견고하나 복잡도 증가.
4. **maxTurns(20) 한계** — triage처럼 긴 작업은 20턴을 넘길 수 있다(`agent.service.ts:424`). 이슈 유형별 maxTurns 조정 or 재개로 이어가기.
5. **GitHub 쓰기 권한** — 라벨/PR 생성은 토큰 스코프가 충분해야 한다(현재 읽기+코멘트만 검증됨).
6. **소유자 삭제 시 토큰 취약** — 워커는 `project.ownerId`로 실행 유저를 정하는데(`issues.service.ts:394`) ownerId는 nullable(소유자 삭제 시 null). ownerId=null + 프로젝트 지정 계정 없음 + `.env` 폴백 없음이면 인증 실패. (크론도 동일 구조라 새 위험은 아님)
7. **health check가 워커 상태 미반영** — `/api/health`는 정적 응답(`health.controller.ts`)이라 워커가 죽어도 ok. 워커 헬스를 헬스체크에 포함할지 검토.
8. **이슈 실행 테스트 부재** — `issues/*.spec.ts` 없음. `agent.spec.ts`도 실행 경로(cwd/동시성)는 안 건드림. 워커 도입 시 회귀 안전망이 없으니 워커 로직 단위 테스트를 함께 작성.

---

## 11. per-run worktree 격리 설계 (같은 프로젝트 동시 실행)

요구사항: **같은 프로젝트의 여러 이슈도 동시에 실행**. 이를 위해 실행마다 독립 작업 디렉터리를 준다.

### 11.1 대전제 확정 — cwd가 로컬 git 저장소여야 함

> **결정: (B) 시스템이 저장소를 직접 관리한다.** 프로젝트의 `gitRepo`(owner/repo)를 시스템이 지정된 위치에 clone하고, 그 clone을 worktree의 base repo로 쓴다. 이유: 현재 `project.cwd`는 "미리 준비된 디렉터리"일 뿐 로컬 git 저장소인지 코드가 보장하지 않고(조사 확인, clone/git 코드 전무), 사용자 자유 입력이라 신뢰할 수 없다. 시스템 관리 clone(옵션 B)이 유일하게 견고하다.
> 상세 설계는 **12절(시스템 관리 clone)** 참조. worktree는 그 관리 clone을 base로 만든다.

### 11.2 실행 단위별 격리 흐름

```
executeRun(issue) {
  const base = <REPOS_ROOT>/<projectId>          // 12절의 시스템 관리 clone
  const wt   = <WORKTREE_ROOT>/<projectId>/<issueId>   // 격리 디렉터리
  const branch = `issue/${issueId}`              // gitBranch를 base로 활용 가능

  try {
    // 1. base에서 최신 fetch (선택) 후 worktree 생성
    git -C <base> worktree add -B <branch> <wt> <origin/기준브랜치>
    // 2. 그 worktree를 cwd로 에이전트 실행
    agent.run(projectId, { ...opts, cwd: wt })   // ← cwd override (신규)
    // 3. 결과 처리 (기존): status/sessionId/result 기록
  } finally {
    // 4. 정리: worktree 제거 (uploads.removeIssueDir 패턴 참고)
    git -C <base> worktree remove --force <wt>
    // 필요 시 브랜치 정리
  }
}
```

- **각 이슈가 자기 worktree**를 가지므로 같은 프로젝트라도 파일/git 충돌 없음 → 진짜 병렬.
- `<WORKTREE_ROOT>`는 `UPLOADS_DIR`처럼 env로 관리 (`ISSUE_WORKTREE_ROOT`, 기본 `apps/api/worktrees`).
- worktree 이름은 `uploads.service.ts`의 "엔티티 id로 디렉터리" 패턴(`:21`) 그대로 차용.
- Windows 경로: `path.join` + posix 정규화(`uploads.service.ts:52` 패턴). SDK cwd로 넘길 때 절대경로.

### 11.3 필요한 코드 변경 (조사로 확정된 지점)

1. **`RunAgentOptions`에 `cwd?: string` 추가** (`agent.service.ts:15-24`) — 현재 없음
2. **`execute()`/`executeStream()`의 cwd를 override 우선으로** (`agent.service.ts:423`, `:218`) — `cwd: opts.cwd ?? project.cwd`
3. **git 조작 도입** — API에 git 라이브러리/명령이 전무(조사 확인). `node:child_process`로 `git worktree` 직접 실행 or `simple-git` 추가
4. **worktree 생성/정리 서비스** 신규 — 정리 패턴은 `uploads.service.ts:99-102`(`fs.rm recursive force`) 참고
5. **`executeRun`에 finally 정리 블록 추가** (`issues.service.ts:379-414`) — 현재 finally/cleanup 없음
6. **`gitBranch` 활용** (`schema.prisma:142`) — 현재 저장만 되고 미사용. worktree 기준 브랜치로 처음 활용

### 11.4 리스크·주의

- **base 저장소 동시 접근**: 여러 worktree가 같은 `.git`을 공유한다. `git worktree add`/`remove`는 base repo의 `.git`에 락을 잡으므로, 동시에 여러 개를 생성/삭제하면 짧은 경합이 생길 수 있다 → worktree 생성/삭제만 프로젝트별 직렬화(짧은 임계구역), 실행 자체는 병렬.
- **디스크**: worktree는 clone보다 가볍지만(작업 트리만 복제, `.git` 공유) 이슈 수만큼 작업 트리가 쌓인다. 정리 실패 시 누적 → 고아 worktree 청소(`git worktree prune`)를 워커 tick 또는 부팅 시 수행.
- **중단 시 정리 누락**: 프로세스가 죽으면 finally가 안 돌아 worktree가 남는다 → onModuleInit/워커에서 `git worktree prune` + 고아 디렉터리 청소.
- **resume + worktree**: 재개(resume) 시 이전과 다른 worktree가 되면 세션의 파일 컨텍스트가 안 맞을 수 있다. 재개는 같은 이슈이므로 worktree 이름을 issueId 기준으로 고정하면 완화되나, 이미 정리된 경우 재생성 필요.
- **maxTurns/장시간**: worktree 병렬 수가 늘면 동시 서브프로세스·토큰 사용량도 비례 증가. AGENT_CONCURRENCY로 상한 유지.

### 11.5 계획 반영

- 이 격리는 **Phase 1에서 함께** 구현해야 한다("같은 프로젝트 동시 실행"이 목표 2의 핵심이므로). 단 12절(시스템 관리 clone) 위에 얹힌다. 9절 Phase 1 체크리스트에 worktree 항목 추가.

---

## 12. 시스템 관리 clone 설계 (옵션 B, worktree의 base)

worktree는 base git 저장소가 있어야 만들 수 있다. 그 base를 **시스템이 직접 clone·관리**한다.

### 12.1 개념

- 프로젝트마다 `gitRepo`(owner/repo)를 시스템이 `<REPOS_ROOT>/<projectId>`에 clone한다.
- 이 clone이 **모든 이슈 실행 worktree의 base**가 된다.
- `cwd`(사용자 자유 입력 필드)는 더 이상 실행 경로의 근거가 아니다 — 실행은 관리 clone에서 파생한 worktree에서 한다.

> **경로는 반드시 `projectId` 기준**으로 격리한다. `gitRepo`에 유일성 제약이 없어(조사 확인, `schema.prisma:141`) 여러 프로젝트가 같은 repo를 가리킬 수 있는데, repo 기준 경로면 서로 충돌한다. `uploads.service.ts`가 `issueId`로 디렉터리를 나누는 관례(`:21`)와 동일하게 `projectId`로 나눈다.

### 12.2 clone 생명주기

> **결정: 지연 clone (첫 실행 시).** 프로젝트 생성 시점엔 clone하지 않고, 워커가 이슈를 실행하기 직전 "clone이 없으면 clone, 있으면 fetch"를 한다. 이유: 워커 흐름(11.2)이 이미 "실행 직전 준비"를 하므로 여기에 자연히 포함되고, 생성 요청이 무거워지지 않으며, clone 실패가 이슈 실행 오류(ERROR)로 자연스럽게 흡수된다. 별도 백그라운드 clone 잡·"준비 중" 상태가 불필요.

| 시점 | 동작 |
|------|------|
| 프로젝트 생성 | clone 안 함 (지연) |
| 이슈 실행 직전 (워커) | clone 없으면 `<REPOS_ROOT>/<projectId>`에 clone, 있으면 `git fetch` → worktree 생성. 실패 시 이슈 ERROR |
| `gitRepo`/`gitBranch` 변경(update) | 기존 clone 무효화(디렉터리 삭제) → 다음 실행 시 재clone (지연 원칙 유지) |
| 프로젝트 삭제 | clone·worktree 디렉터리 정리 (현재 `remove`는 디스크 정리 없음 — `projects.service.ts:213`) |

### 12.3 인증 clone

- 토큰: `gitTokenEnc` 복호화 (`crypto.decryptOptional`, `issues.service.ts:213` `tokenOf` 패턴 재사용)
- clone URL: `https://x-access-token:<token>@github.com/<owner>/<repo>.git`
  - `<owner>/<repo>`는 `GithubService.parseRepo`(`github.service.ts:60`)로 추출 — 이미 owner/repo·URL·SSH 형식 모두 파싱함
  - ⚠️ **주의**: 인증 URL을 remote에 저장하면 토큰이 `.git/config`에 평문으로 남는다. `git -c http.extraHeader="Authorization: Bearer <token>"` 방식으로 넣거나, clone 후 remote URL을 토큰 없는 형태로 재설정할 것.
- 이 clone용 git 인증 패턴은 **현재 전무**(REST 헤더·env 주입만 있음, 조사 확인) → 신규 작성.

### 12.4 저장 위치

- `<REPOS_ROOT>` = `process.env.REPOS_DIR ?? path.join(process.cwd(), "repos")` (uploads.service.ts:18 패턴)
- ⚠️ **UPLOADS_DIR와 분리**할 것 — UPLOADS_DIR는 `/uploads`로 정적 서빙되므로(`main.ts:12`), 소스코드 clone을 거기 두면 외부 노출된다.
- worktree는 `<WORKTREE_ROOT>` (11.2, 별도 env 또는 `<REPOS_ROOT>/../worktrees`)

### 12.5 `cwd` 필드 처리 (기존과의 관계)

현재 `cwd`는 create-project에서 **필수·자유입력**(`create-project.dto.ts:15`)이고 실행 작업 디렉터리로만 쓰인다(`agent.service.ts:218,423`). 옵션 B와 이중화된다.

> **결정: cwd를 실행 근거에서 완전히 제거한다 (하위호환 무시).** 모든 실행(이슈·크론)은 관리 clone→worktree만 사용한다. `cwd` 폴백 경로는 두지 않는다. 코드 경로가 하나로 통일되어 깔끔하다.

구체적으로:
- `execute()`/`executeStream()`의 cwd는 **항상 worktree 경로**(호출측이 opts.cwd로 주입). `project.cwd`를 직접 참조하지 않는다.
- `create-project.dto.ts`의 `cwd` 필수 제약을 제거하거나 필드 자체를 폐기. 대신 `gitRepo`가 실행의 전제(gitRepo 없으면 실행 불가로 처리).
- **기존 프로젝트 마이그레이션**: 이미 cwd로 돌던 프로젝트(예 `E:\project\tom-jira-app`)는 `gitRepo`를 채워 관리 clone 방식으로 전환한다. gitRepo가 없던 로컬 전용 프로젝트는 실행하려면 gitRepo 지정이 필수가 된다.

> ⚠️ 크론(`cron-registry.service.ts:68`)도 같은 실행 경로를 쓰므로, cwd 제거는 크론 실행에도 영향. 크론도 gitRepo 기반 clone/worktree로 통일해야 한다.

### 12.6 리스크

- **clone 비용/시간**: 지연 clone이므로 프로젝트 생성은 빠르나, **그 프로젝트의 첫 이슈 실행이 최초 clone만큼 느리다**(1회성, 워커가 백그라운드로 도니 체감은 적음). 대형 repo면 `--depth`(shallow) clone 고려. 다만 worktree/브랜치 작업엔 full 히스토리가 필요할 수 있어 트레이드오프 검토.
- **디스크**: 프로젝트마다 full clone + 이슈마다 worktree. 대형 repo 다수면 부담. `git worktree prune` + 오래된 clone 정리 정책 필요.
- **base 동시 접근**: 여러 worktree가 같은 `.git` 공유 — worktree add/remove·fetch는 짧게 직렬화(11.4).
- **fetch 실패/네트워크**: 실행 직전 fetch가 실패해도 기존 clone으로 진행할지, 실패 처리할지 정책 필요.
- **토큰 노출**: 12.3 주의 — `.git/config`에 토큰 잔류 금지.

### 12.7 계획 반영

옵션 B는 worktree(11절)의 **선행 토대**다. Phase 1 순서: ① clone 관리 서비스 → ② worktree 격리 → ③ 워커. 9절 체크리스트에 반영.

---

## 부록: 조사로 확인한 현재 코드 위치

- 이슈 실행: `apps/api/src/issues/issues.service.ts` — `startRun`(:345), `executeRun`(:379), `onModuleInit` 고아 정리(:50)
- 에이전트: `apps/api/src/agent/agent.service.ts` — `run`/`execute`, `p-limit`(:71), `maxTurns`(:424)
- 상태 매핑: `issues.service.ts:32` `STATUS_TO_DTO`
- GitHub: `apps/api/src/github/github.service.ts` — list/get/listComments/createComment만 (라벨 쓰기·PR 없음)
- 크론(참고 패턴): `apps/api/src/cron/cron-registry.service.ts` — SchedulerRegistry 동적 등록 + 부팅 복원
- 데이터 모델: `apps/api/prisma/schema.prisma` — `IssueTask`(:168), `IssueStatus`(:19)
- shared 타입: `packages/shared/src/types.ts` — `IssueTask`(:53), `IssueTaskStatus`(:43)
- 배포: `render.yaml`(단일 web + postgres), `docker-compose.yml`(db/api/web, redis 없음)
