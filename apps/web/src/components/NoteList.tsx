"use client";

import { useState } from "react";
import type { IssueNote, IssueNoteAuthor } from "@claude-app/shared";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/Markdown";
import { formatAbsolute, formatRelative } from "@/lib/utils";

/** 작성자별 배지 라벨·색. 사람/에이전트/시스템을 한눈에 구분한다. */
const AUTHOR_META: Record<
  IssueNoteAuthor,
  { label: string; variant: "default" | "muted" | "outline" }
> = {
  human: { label: "사람", variant: "default" },
  agent: { label: "에이전트", variant: "outline" },
  system: { label: "시스템", variant: "muted" },
};

/** 이 줄 수를 넘는 노트는 접어서 보여준다(긴 에이전트 조사 결과가 화면을 덮는 것 방지). */
const COLLAPSE_LINES = 12;

/**
 * 이력 노트 한 건. 작성자 배지 + 시각을 머리줄에 두고, 내용은 마크다운으로 렌더한다.
 * 에이전트 노트는 백틱 코드·목록을 쓰므로 평문으로 두면 읽기 어렵다.
 */
function NoteItem({ note }: { note: IssueNote }) {
  const [expanded, setExpanded] = useState(false);
  const meta = AUTHOR_META[note.author] ?? {
    label: note.author,
    variant: "muted" as const,
  };
  // 실제 줄 수 기준으로만 접는다(짧은 노트는 토글이 없어야 깔끔하다).
  const long = note.content.split("\n").length > COLLAPSE_LINES;
  const collapsed = long && !expanded;

  return (
    <div className="min-w-0 rounded-md border border-border bg-secondary/20 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <Badge variant={meta.variant}>{meta.label}</Badge>
        <span
          className="text-xs text-muted-foreground"
          title={formatAbsolute(note.createdAt)}
        >
          {formatRelative(note.createdAt)}
        </span>
      </div>
      <div
        className={
          collapsed
            ? "relative max-h-48 overflow-hidden after:absolute after:inset-x-0 after:bottom-0 after:h-12 after:bg-gradient-to-t after:from-secondary/60 after:to-transparent"
            : undefined
        }
      >
        <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-pre:my-2">
          {note.content}
        </Markdown>
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 cursor-pointer text-xs text-[var(--accent)] underline underline-offset-2"
        >
          {expanded ? "접기" : "더 보기"}
        </button>
      )}
    </div>
  );
}

/**
 * 이슈 이력(notes) 목록. notes가 null이면 로딩 중으로 본다.
 * 이슈 상세·재실행 다이얼로그가 공유한다.
 */
export function NoteList({ notes }: { notes: IssueNote[] | null }) {
  if (notes === null)
    return <p className="text-sm text-muted-foreground">불러오는 중…</p>;
  if (notes.length === 0)
    return <p className="text-sm text-muted-foreground">이력이 없습니다.</p>;
  return (
    <div className="space-y-2">
      {notes.map((n) => (
        <NoteItem key={n.id} note={n} />
      ))}
    </div>
  );
}
