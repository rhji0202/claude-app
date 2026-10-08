"use client";

import Link from "next/link";
import { Bot, MessageSquare } from "lucide-react";
import type { GhIssue } from "@claude-app/shared";
import { Button } from "@/components/ui/button";
import { GhAvatar, GhStateIcon } from "./GhBits";
import { GhLabelChip } from "./GhLabelChip";
import { absoluteTime, relativeTime } from "./gh-utils";

/**
 * GitHub 이슈 목록(GitHub의 issue list 행 레이아웃을 따른다).
 * ⚠️ GitHub Issue 뷰어 전용 (docs/rules/github-issue-separation.md).
 */
export function GhIssueList({
  projectId,
  issues,
  onOpen,
  onLabelClick,
  activeLabels,
}: {
  projectId: string;
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
              {/* 이슈 화면으로 넘기는 링크일 뿐 — 뷰어는 큐에 넣지 않는다(규칙 3).
                  행 클릭(상세 열기)으로 번지지 않게 전파를 막는다. */}
              <Button
                asChild
                variant="secondary"
                size="sm"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Link
                  href={`/issues?import=${encodeURIComponent(projectId)}&number=${issue.number}`}
                  title="이슈 화면에서 이 이슈를 에이전트 작업 큐에 추가합니다."
                >
                  <Bot className="size-4" />
                  <span className="hidden sm:inline">에이전트로 처리</span>
                </Link>
              </Button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
