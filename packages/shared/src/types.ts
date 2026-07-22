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
  hasAnthropicApiKey: boolean;
  hasGitToken: boolean;
}

export type ProjectVisibility = "private" | "shared" | "public";

export interface Project {
  id: ID;
  name: string;
  description?: string | null;
  /** 에이전트 실행 작업 디렉터리 */
  cwd: string;
  model?: string | null;
  allowedTools: string[];

  // 프로젝트별 git 연결
  gitRepo?: string | null;
  gitBranch?: string | null;

  // 프로젝트별 Anthropic 설정 (키 자체는 노출 안 함)
  anthropicBaseUrl?: string | null;

  // 소유/공개 범위
  ownerId?: string | null;
  visibility: ProjectVisibility;

  /** 시크릿 보유 여부 (값은 내려주지 않음) */
  secrets: SecretStatus;

  createdAt: string;
  updatedAt: string;
}

export type IssueTaskStatus = "queued" | "running" | "done" | "error";

/** 이슈 출처: GitHub 동기화 vs 공유 링크를 통한 테스터 수동 등록 */
export type IssueSource = "github" | "manual";

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
  status: IssueTaskStatus;
  sessionId?: string | null;
  result?: string | null;
  error?: string | null;
  resultCommentUrl?: string | null;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
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

export interface User {
  id: ID;
  email: string;
  name?: string | null;
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
