/**
 * 공유 도메인 타입 - NestJS API와 Next.js UI가 함께 사용한다.
 *
 * 런타임 값(enum/zod) 없이 순수 타입만 두어 별도 빌드 단계 없이
 * 두 앱에서 타입-only import로 소비할 수 있게 한다.
 * (DB 스키마의 원천은 Prisma. 여기 타입은 API 경계에서 주고받는 DTO 형태.)
 */

export type ID = string;

/** 시크릿 필드는 API 응답에서 절대 노출하지 않는다. 대신 보유 여부만 내려준다. */
export interface SecretStatus {
  hasGitToken: boolean;
  /** 알림 webhook URL 설정 여부(값은 내려주지 않음) */
  hasNotifyWebhook: boolean;
}

export type ProjectVisibility = "private" | "shared" | "public";

export interface Project {
  id: ID;
  name: string;
  description?: string | null;
  /** 에이전트 실행 작업 디렉터리 */
  cwd: string;

  // 프로젝트별 git 연결
  gitRepo?: string | null;
  gitBranch?: string | null;

  /** 이슈 실행 결과를 브랜치 push + PR로 만들지 여부(gh CLI) */
  autoPr?: boolean;

  /** PR 생성 후 자동 머지까지 진행할지(autoPr가 true일 때만 유효) */
  autoMerge?: boolean;

  /** 이슈 실행 전 triage 분류를 수행하고 라벨·코멘트로 반영할지 */
  autoTriage?: boolean;

  /** 이 프로젝트가 사용할 Claude 계정 id (미지정 시 활성 계정 폴백) */
  claudeAccountId?: string | null;

  // 소유/공개 범위
  ownerId?: string | null;
  visibility: ProjectVisibility;

  /** 시크릿 보유 여부 (값은 내려주지 않음) */
  secrets: SecretStatus;

  createdAt: string;
  updatedAt: string;
}

export type IssueTaskStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "interrupted"
  | "needs_decision";

/** 이슈 메모 작성 주체 */
export type IssueNoteAuthor = "human" | "agent" | "system";

/** 실행 진행 이벤트 한 건(실행 중 타임라인). */
export interface IssueProgressEvent {
  /** tool = 도구 호출, text = 텍스트 작성 */
  t: "tool" | "text";
  /** 도구 이름(t=tool일 때) */
  name?: string;
  /** 내용 요약: 도구 입력 요약 또는 텍스트 앞부분(길이 제한) */
  detail?: string;
  /** ISO 시각 */
  at: string;
}

/** 이슈 메모/이력 한 건(결정 대기 흐름·진행 이력). */
export interface IssueNote {
  id: ID;
  issueId: ID;
  author: IssueNoteAuthor;
  content: string;
  createdAt: string;
}

/** 이슈 출처: GitHub 동기화 vs 공유 링크를 통한 테스터 수동 등록 */
export type IssueSource = "github" | "manual";

/** triage 분류 카테고리 */
export type IssueCategory =
  | "auto-fix"
  | "needs-decision"
  | "needs-info"
  | "question";

export interface IssueTask {
  id: ID;
  projectId: ID;
  repo: string;
  issueNumber?: number | null;
  title: string;
  body?: string | null;
  url?: string | null;
  labels: string[];
  author?: string | null;
  source: IssueSource;
  prompt?: string | null;
  /** 첨부 이미지 저장 상대경로 목록 (UPLOADS_DIR 기준) */
  images: string[];
  status: IssueTaskStatus;
  sessionId?: string | null;
  result?: string | null;
  error?: string | null;
  resultCommentUrl?: string | null;
  /** autoPr 실행으로 생성된 PR URL (있으면 링크 표시) */
  prUrl?: string | null;
  /** triage 분류 결과(미분류면 null) */
  category?: IssueCategory | null;
  /** 실행 중 진행 상황 요약(RUNNING일 때만) */
  progress?: string | null;
  /** 실행 진행 이벤트 타임라인(최근순 누적) */
  progressLog?: IssueProgressEvent[] | null;
  createdAt: string;
  updatedAt: string;
}

/** 워커 현황 대시보드 요약(GET /issues/stats). */
export interface IssueWorkerStats {
  /** 실행 슬롯: 동시 실행 상한·현재 실행 수·여유 슬롯. */
  slots: { concurrency: number; running: number; free: number };
  /** 상태별 이슈 개수(접근 가능한 프로젝트 한정). */
  counts: Record<IssueTaskStatus, number>;
  /** 재시도 대기 건수(ERROR/INTERRUPTED 이면서 재시도 여지 있음). */
  retrying: number;
  /** 가장 오래된 QUEUED 이슈의 생성 시각(큐 적체 신호, 없으면 null). */
  oldestQueuedAt: string | null;
  /** 워커 런타임 상태. */
  worker: { workerId: string; paused: boolean };
}

export type CronStatus = "ok" | "error";

export interface CronJob {
  id: ID;
  name: string;
  /** 표준 5필드 크론식 */
  schedule: string;
  prompt: string;
  projectId: ID;
  enabled: boolean;
  lastRunAt?: string | null;
  lastResult?: string | null;
  lastStatus?: CronStatus | null;
  /** 다음 실행 예정 시각(스케줄에서 계산, enabled일 때만) */
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 크론 1회 실행 이력. */
export interface CronRun {
  id: ID;
  cronJobId: ID;
  /** 진행 중이면 null, 종료 시 ok/error */
  status?: CronStatus | null;
  result?: string | null;
  error?: string | null;
  sessionId?: string | null;
  durationMs?: number | null;
  startedAt: string;
  finishedAt?: string | null;
}

export type SkillScope = "global" | "project";

export interface Skill {
  id: ID;
  name: string;
  description: string;
  content: string;
  scope: SkillScope;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type McpServerType = "stdio" | "http" | "sse";

export interface McpServer {
  id: ID;
  name: string;
  type: McpServerType;
  command?: string | null;
  args: string[];
  url?: string | null;
  /** 시크릿을 포함할 수 있어 값은 노출하지 않고 키 목록만 내려줄 수 있다. */
  envKeys?: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- 인증 / 공유 ----

export type UserRole = "owner" | "editor" | "viewer";

/** 전역(시스템) 역할 — 프로젝트 단위 UserRole과 별개 */
export type GlobalRole = "admin" | "member";

export interface User {
  id: ID;
  email: string;
  name?: string | null;
  role: GlobalRole;
  disabled: boolean;
  createdAt: string;
}

export interface ProjectShare {
  projectId: ID;
  userId: ID;
  role: UserRole;
}

/** 공유 링크: 로그인 없이 프로젝트에 스코프된 접근을 부여 */
export type ShareLinkScope =
  | "read" // 읽기 전용 대시보드
  | "issue_report"; // 테스터가 이슈를 수동 등록 가능

export interface ShareLink {
  id: ID;
  token: string;
  projectId: ID;
  scope: ShareLinkScope;
  expiresAt?: string | null;
  createdAt: string;
}

// ---- API 요청 페이로드 (DTO 형태) ----

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthResult {
  accessToken: string;
  user: User;
}

/** 공유 링크를 통한 테스터의 수동 이슈 등록 */
export interface ManualIssueReport {
  title: string;
  body?: string;
  labels?: string[];
  reporter?: string;
}
