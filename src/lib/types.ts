/**
 * 도메인 모델 정의 - 5개 관리 모듈이 공유하는 타입.
 */

export type ID = string;

/** 프로젝트: 에이전트 실행의 작업 컨텍스트(작업 디렉터리, 모델, 허용 도구 등) */
export interface Project {
  id: ID;
  name: string;
  description?: string;
  /** 에이전트가 실행될 작업 디렉터리(cwd) */
  cwd: string;
  /** GitHub owner/repo (이슈 처리 모듈에서 사용) */
  repo?: string;
  model?: string;
  /** 허용할 도구 목록 (예: "Read", "Write", "mcp__github__*") */
  allowedTools?: string[];
  /** 이 프로젝트에서 사용할 MCP 서버 id 목록 */
  mcpServerIds?: ID[];
  /** 이 프로젝트에서 사용할 스킬 id 목록 */
  skillIds?: ID[];
  createdAt: string;
  updatedAt: string;
}

export type IssueTaskStatus = "queued" | "running" | "done" | "error";

/** GitHub 이슈 처리 작업 */
export interface IssueTask {
  id: ID;
  projectId: ID;
  repo: string;
  issueNumber: number;
  title: string;
  /** GitHub에서 가져온 이슈 본문 */
  body?: string;
  /** GitHub 이슈 URL */
  url?: string;
  /** 이슈 라벨 */
  labels?: string[];
  /** 이슈 작성자 로그인 */
  author?: string;
  /** 에이전트에게 줄 지시(미지정 시 이슈 본문 기반 기본 프롬프트 생성) */
  prompt?: string;
  status: IssueTaskStatus;
  sessionId?: string;
  result?: string;
  error?: string;
  /** 결과를 이슈에 코멘트로 남겼을 때의 코멘트 URL */
  resultCommentUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/** 크론 작업: 정해진 스케줄에 에이전트 프롬프트를 실행 */
export interface CronJob {
  id: ID;
  name: string;
  /** 표준 5필드 크론식 (분 시 일 월 요일) */
  schedule: string;
  prompt: string;
  projectId: ID;
  enabled: boolean;
  lastRunAt?: string;
  lastResult?: string;
  lastStatus?: "ok" | "error";
  createdAt: string;
  updatedAt: string;
}

export type SkillScope = "global" | "project";

/** 스킬: 재사용 가능한 지시/워크플로 묶음 */
export interface Skill {
  id: ID;
  name: string;
  description: string;
  /** 스킬 본문 (SKILL.md 형식의 마크다운) */
  content: string;
  scope: SkillScope;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type McpServerType = "stdio" | "http" | "sse";

/** MCP 서버 설정 */
export interface McpServer {
  id: ID;
  name: string;
  type: McpServerType;
  /** stdio 타입일 때 실행 명령 */
  command?: string;
  args?: string[];
  /** http/sse 타입일 때 URL */
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 스토어의 컬렉션 이름 → 레코드 타입 매핑 */
export interface Collections {
  projects: Project;
  issueTasks: IssueTask;
  cronJobs: CronJob;
  skills: Skill;
  mcpServers: McpServer;
}

export type CollectionName = keyof Collections;
