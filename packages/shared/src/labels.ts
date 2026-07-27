import type { IssueCategory, IssueSource, IssueTaskStatus } from "./types";

/**
 * 이슈 상태 → 한글 라벨. Record로 묶어두면 IssueTaskStatus에 상태가
 * 추가될 때 컴파일 에러로 드러난다(라벨 누락 방지).
 */
export const ISSUE_STATUS_LABEL: Record<IssueTaskStatus, string> = {
  draft: "작성 중",
  queued: "대기",
  running: "실행 중",
  done: "완료",
  error: "오류",
  interrupted: "중단됨",
  needs_decision: "결정 대기",
};

/** 상태 필터 드롭다운 순서(작업 흐름 순). */
export const ISSUE_STATUS_ORDER: IssueTaskStatus[] = [
  "queued",
  "running",
  "needs_decision",
  "done",
  "error",
  "interrupted",
];

/** triage 분류 → 한글 라벨. */
export const ISSUE_CATEGORY_LABEL: Record<IssueCategory, string> = {
  "auto-fix": "자동수정",
  "needs-decision": "결정필요",
  "needs-info": "정보부족",
  question: "질문",
};

/** 이슈 출처 → 한글 라벨. */
export const ISSUE_SOURCE_LABEL: Record<IssueSource, string> = {
  github: "GitHub",
  manual: "수동 등록",
};

/** 알 수 없는 값이 와도 화면이 깨지지 않도록 원문으로 폴백한다. */
export function issueStatusLabel(status: string): string {
  return ISSUE_STATUS_LABEL[status as IssueTaskStatus] ?? status;
}

export function issueCategoryLabel(category: string): string {
  return ISSUE_CATEGORY_LABEL[category as IssueCategory] ?? category;
}

export function issueSourceLabel(source: string): string {
  return ISSUE_SOURCE_LABEL[source as IssueSource] ?? source;
}
