"use client";

import type { GhLabel } from "@claude-app/shared";
import { ghLabelTextColor } from "@claude-app/shared";
import { cn } from "@/lib/utils";

/**
 * GitHub 라벨 칩. 저장소가 지정한 색을 그대로 쓰고 대비에 맞춰 글자색을 고른다.
 * ⚠️ GitHub Issue 뷰어 전용 (docs/rules/github-issue-separation.md).
 */
export function GhLabelChip({
  label,
  onClick,
  active,
  className,
}: {
  label: GhLabel;
  onClick?: (name: string) => void;
  active?: boolean;
  className?: string;
}) {
  const bg = `#${label.color.replace(/^#/, "")}`;
  const fg = ghLabelTextColor(label.color);
  const style = { backgroundColor: bg, color: fg } as const;
  const base = cn(
    "inline-flex max-w-[14rem] items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
    active && "ring-2 ring-offset-1 ring-accent ring-offset-background",
    onClick && "cursor-pointer hover:opacity-80",
    className,
  );

  if (!onClick) {
    return (
      <span className={base} style={style} title={label.description ?? label.name}>
        {label.name}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={base}
      style={style}
      title={label.description ?? label.name}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick(label.name);
      }}
    >
      {label.name}
    </button>
  );
}
