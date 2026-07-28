/**
 * GitHub Issue 뷰어(메뉴: "GitHub Issue", 경로: /github-issues) 전용 타입.
 *
 * ⚠️ 절대 규칙 — 이 파일의 타입은 에이전트 실행 큐(IssueTask, ./types.ts)와
 * 완전히 별개다. 두 기능은 서로의 타입·서비스·엔드포인트를 공유하지 않는다.
 * 자세한 규칙은 docs/rules/github-issue-separation.md 참고.
 *
 * 여기 타입은 GitHub REST v3 응답을 UI가 쓰기 좋게 정규화한 형태이며,
 * DB에 저장하지 않는 실시간 프록시 결과다(Gh* 접두사로 구분).
 */

/** 이슈 열림/닫힘 상태. GitHub의 state와 동일. */
export type GhIssueState = "open" | "closed";

/** 목록 필터의 상태 값(전체 포함). */
export type GhIssueStateFilter = GhIssueState | "all";

/** 닫힌 사유(GitHub state_reason). */
export type GhIssueStateReason = "completed" | "not_planned" | "reopened";

/** 목록 정렬 기준. */
export type GhIssueSort = "created" | "updated" | "comments";

export type GhSortDirection = "asc" | "desc";

/** GitHub 계정(작성자·담당자). */
export interface GhUser {
  login: string;
  avatarUrl: string | null;
  htmlUrl: string | null;
}

/** 라벨(= 태그). color는 GitHub 그대로 `#` 없는 6자리 hex. */
export interface GhLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

/** 마일스톤(요약). */
export interface GhMilestone {
  number: number;
  title: string;
  state: GhIssueState;
  dueOn: string | null;
}

/** 이슈 한 건(목록·상세 공통). */
export interface GhIssue {
  number: number;
  title: string;
  /** 목록 응답에서도 body를 내려준다(미리보기·검색용). */
  body: string | null;
  state: GhIssueState;
  stateReason: GhIssueStateReason | null;
  htmlUrl: string;
  labels: GhLabel[];
  author: GhUser | null;
  assignees: GhUser[];
  milestone: GhMilestone | null;
  comments: number;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /**
   * 본문 이미지 `{ 원본 GitHub URL: 서명된 프록시 경로 }`.
   * GitHub 첨부는 인증이 필요해 브라우저가 직접 못 여니, 서버 프록시 경로로
   * 갈아끼워 렌더한다. 경로는 API 베이스(`/api`) 기준 상대값이다.
   */
  imageMap: Record<string, string>;
}

/** 이슈 코멘트 한 건. */
export interface GhComment {
  id: number;
  body: string;
  author: GhUser | null;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  /** 코멘트 본문 이미지 매핑. GhIssue.imageMap과 같은 규칙. */
  imageMap: Record<string, string>;
}

/** 저장소 요약(탭 헤더 표시용). */
export interface GhRepoInfo {
  owner: string;
  name: string;
  htmlUrl: string;
}

/** 목록 응답. GitHub는 총 개수를 주지 않으므로 다음 페이지 존재 여부만 내려준다. */
export interface GhIssueListResult {
  repo: GhRepoInfo;
  issues: GhIssue[];
  page: number;
  perPage: number;
  hasNextPage: boolean;
  /** 열림/닫힘 개수(Search API 집계). 조회 실패 시 null. */
  counts: { open: number; closed: number } | null;
}

/** 목록 조회 쿼리. */
export interface GhIssueListQuery {
  state?: GhIssueStateFilter;
  /** 라벨 이름(AND 조건). */
  labels?: string[];
  /** 제목·본문 부분 검색어. */
  q?: string;
  sort?: GhIssueSort;
  direction?: GhSortDirection;
  page?: number;
  perPage?: number;
}

/** 이슈 생성 요청. */
export interface GhCreateIssueInput {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

/** 이슈 수정 요청(제목·본문·라벨·상태). */
export interface GhUpdateIssueInput {
  title?: string;
  body?: string;
  labels?: string[];
  state?: GhIssueState;
  stateReason?: GhIssueStateReason;
}

/** 상태 → 한글 라벨(뱃지 표기용). */
export const GH_ISSUE_STATE_LABEL: Record<GhIssueState, string> = {
  open: "열림",
  closed: "닫힘",
};

/** 닫힌 사유 → 한글 라벨. */
export const GH_ISSUE_STATE_REASON_LABEL: Record<GhIssueStateReason, string> = {
  completed: "완료됨",
  not_planned: "진행 안 함",
  reopened: "다시 열림",
};

/**
 * 라벨 배경색(hex, `#` 없음)에 대해 읽히는 전경색을 고른다.
 * GitHub와 동일한 YIQ 밝기 기준.
 */
export function ghLabelTextColor(hex: string): "#000000" | "#ffffff" {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) return "#000000";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return "#000000";
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#000000" : "#ffffff";
}
