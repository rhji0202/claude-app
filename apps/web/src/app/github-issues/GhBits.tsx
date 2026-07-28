"use client";

import { CheckCircle2, CircleDot, CircleSlash } from "lucide-react";
import type { GhIssue, GhUser } from "@claude-app/shared";
import { cn } from "@/lib/utils";

/**
 * GitHub Issue 뷰어의 작은 표시 요소들(상태 아이콘·배지·아바타).
 * ⚠️ 전용 컴포넌트 — 에이전트 이슈 큐 UI와 공유하지 않는다.
 * docs/rules/github-issue-separation.md 참고.
 */

/** 목록 왼쪽의 상태 아이콘 (열림=초록 점, 닫힘=보라 체크, 진행 안 함=회색). */
export function GhStateIcon({
  issue,
  className,
}: {
  issue: Pick<GhIssue, "state" | "stateReason">;
  className?: string;
}) {
  if (issue.state === "open") {
    return <CircleDot className={cn("size-4 text-success", className)} />;
  }
  if (issue.stateReason === "not_planned") {
    return <CircleSlash className={cn("size-4 text-muted-foreground", className)} />;
  }
  return <CheckCircle2 className={cn("size-4 text-[#8250df]", className)} />;
}

/** 상세 화면 상단의 Open/Closed 알약 배지(GitHub와 같은 색). */
export function GhStateBadge({
  issue,
}: {
  issue: Pick<GhIssue, "state" | "stateReason">;
}) {
  const open = issue.state === "open";
  const notPlanned = issue.stateReason === "not_planned";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium text-white",
        open ? "bg-[#1a7f37]" : notPlanned ? "bg-[#6e7781]" : "bg-[#8250df]",
      )}
    >
      <GhStateIcon issue={issue} className="size-4 text-white" />
      {open ? "열림" : notPlanned ? "진행 안 함" : "닫힘"}
    </span>
  );
}

/** 사용자 아바타(없으면 이니셜 원). */
export function GhAvatar({
  user,
  size = 20,
}: {
  user: GhUser | null;
  size?: number;
}) {
  if (!user) return null;
  if (user.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt={user.login}
        title={user.login}
        width={size}
        height={size}
        className="shrink-0 rounded-full"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase text-muted-foreground"
      style={{ width: size, height: size }}
      title={user.login}
    >
      {user.login.slice(0, 1)}
    </span>
  );
}
