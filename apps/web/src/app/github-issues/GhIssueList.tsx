"use client";

import { MessageSquare } from "lucide-react";
import type { GhIssue } from "@claude-app/shared";
import { GhAvatar, GhStateIcon } from "./GhBits";
import { GhLabelChip } from "./GhLabelChip";
import { absoluteTime, relativeTime } from "./gh-utils";

/**
 * GitHub 이슈 목록(GitHub의 issue list 행 레이아웃을 따른다).
 * ⚠️ GitHub Issue 뷰어 전용 (docs/rules/github-issue-separation.md).
 */
export function GhIssueList({
  issues,
  onOpen,
  onLabelClick,
  activeLabels,
}: {
  issues: GhIssue[];
  onOpen: (number: number) => void;
  onLabelClick: (name: string) => void;
  activeLabels: string[];
}) {
  return (
    <ul className="divide-y divide-border">
      {issues.map((issue) => (
        <li key={issue.number}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => onOpen(issue.number)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(issue.number);
              }
            }}
            className="flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-secondary/50 sm:px-4"
          >
            <GhStateIcon issue={issue} className="mt-0.5 shrink-0" />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold leading-snug hover:text-accent">
                  {issue.title}
                </span>
                {issue.labels.map((label) => (
                  <GhLabelChip
                    key={`${issue.number}-${label.name}`}
                    label={label}
                    onClick={onLabelClick}
                    active={activeLabels.includes(label.name)}
                  />
                ))}
              </div>

              <div className="mt-1 text-xs text-muted-foreground">
                <span title={absoluteTime(issue.createdAt)}>
                  #{issue.number} · {issue.author?.login ?? "알 수 없음"}님이{" "}
                  {relativeTime(issue.createdAt)} 등록
                </span>
                {issue.state === "closed" && issue.closedAt && (
                  <span title={absoluteTime(issue.closedAt)}>
                    {" "}
                    · {relativeTime(issue.closedAt)} 닫힘
                  </span>
                )}
                {issue.milestone && <span> · 🏷 {issue.milestone.title}</span>}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3 pl-2">
              <div className="flex -space-x-1.5">
                {issue.assignees.slice(0, 3).map((u) => (
                  <GhAvatar key={u.login} user={u} size={20} />
                ))}
              </div>
              {issue.comments > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MessageSquare className="size-3.5" />
                  {issue.comments}
                </span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
