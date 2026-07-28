/**
 * GitHub Issue 뷰어 전용 유틸.
 *
 * ⚠️ 절대 규칙 — 에이전트 이슈 큐(/issues)와 공유하지 않는 별도 기능이다.
 * docs/rules/github-issue-separation.md 참고.
 */

import type { GhIssueListQuery } from "@claude-app/shared";

/** `3분 전`, `2일 전`, `2025년 3월 4일` 형태의 상대 시간(GitHub 표기 방식). */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  const month = 30 * day;

  if (diff < min) return "방금 전";
  if (diff < hour) return `${Math.floor(diff / min)}분 전`;
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
  if (diff < month) return `${Math.floor(diff / day)}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** 절대 시각(툴팁용). */
export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR");
}

/** 목록 조회 쿼리 → 쿼리스트링. 빈 값은 생략한다. */
export function buildListQuery(q: GhIssueListQuery): string {
  const p = new URLSearchParams();
  if (q.state) p.set("state", q.state);
  if (q.labels && q.labels.length > 0) p.set("labels", q.labels.join(","));
  if (q.q) p.set("q", q.q);
  if (q.sort) p.set("sort", q.sort);
  if (q.direction) p.set("direction", q.direction);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  if (q.perPage) p.set("perPage", String(q.perPage));
  const s = p.toString();
  return s ? `?${s}` : "";
}
