"use client";

import { useState } from "react";
import {
  ChevronRight,
  FilePen,
  FilePlus,
  FileText,
  Terminal,
  Search,
  Globe,
  ListTodo,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 도구 이름 → 사람이 읽는 동작 라벨·아이콘 매핑(claude-desktop식).
 * SDK 도구명 규칙(Edit/Write/Read/Bash/Grep/Glob/WebFetch/WebSearch/TodoWrite).
 * MCP 도구(mcp__…)나 미매핑 도구는 기본(렌치)으로 떨어진다.
 */
const TOOL_META: Record<string, { label: string; icon: LucideIcon }> = {
  Edit: { label: "편집", icon: FilePen },
  MultiEdit: { label: "편집", icon: FilePen },
  Write: { label: "작성", icon: FilePlus },
  NotebookEdit: { label: "편집", icon: FilePen },
  Read: { label: "읽기", icon: FileText },
  Bash: { label: "실행", icon: Terminal },
  Grep: { label: "검색", icon: Search },
  Glob: { label: "탐색", icon: Search },
  WebFetch: { label: "가져오기", icon: Globe },
  WebSearch: { label: "웹 검색", icon: Globe },
  TodoWrite: { label: "할 일", icon: ListTodo },
};

function metaFor(name: string): { label: string | null; icon: LucideIcon } {
  const m = TOOL_META[name];
  if (m) return m;
  return { label: null, icon: Wrench };
}

/** 편집/작성 도구인지(펼침 시 diff/내용 뷰 대상). */
function isFileTool(name: string): boolean {
  return (
    name === "Edit" ||
    name === "MultiEdit" ||
    name === "Write" ||
    name === "NotebookEdit"
  );
}

/** 파일 경로에서 마지막 세그먼트(파일명)만. 없으면 원본. */
function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

interface ParsedInput {
  filePath?: string;
  command?: string;
  pattern?: string;
  url?: string;
  oldString?: string;
  newString?: string;
  content?: string;
  edits?: { oldString: string; newString: string }[];
}

/** 도구 input(JSON 문자열)을 알려진 필드로 파싱. 실패하면 빈 객체. */
function parseInput(raw: string | undefined): ParsedInput {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
    const edits = Array.isArray(o.edits)
      ? (o.edits as Record<string, unknown>[])
          .map((e) => ({
            oldString: typeof e.old_string === "string" ? e.old_string : "",
            newString: typeof e.new_string === "string" ? e.new_string : "",
          }))
          .filter((e) => e.oldString || e.newString)
      : undefined;
    return {
      filePath: str("file_path") ?? str("path") ?? str("notebook_path"),
      command: str("command"),
      pattern: str("pattern"),
      url: str("url"),
      oldString: str("old_string"),
      newString: str("new_string"),
      content: str("content") ?? str("new_source"),
      edits,
    };
  } catch {
    return {};
  }
}

/**
 * 도구 헤더의 대상 요약("foo.ts", "npm test" 등). 없으면 detail 폴백.
 */
function targetLabel(name: string, p: ParsedInput, detail?: string): string | null {
  if (p.filePath) return basename(p.filePath);
  if (p.command) return p.command;
  if (p.pattern) return p.pattern;
  if (p.url) return p.url;
  return detail ?? null;
}

/** old→new 한 쌍을 diff 스타일로. */
function DiffBlock({ oldStr, newStr }: { oldStr?: string; newStr?: string }) {
  return (
    <div className="overflow-x-auto font-mono text-[11px] leading-relaxed">
      {oldStr ? (
        <pre className="whitespace-pre-wrap bg-destructive/10 px-2 py-1 text-destructive">
          {oldStr
            .split("\n")
            .map((l) => `- ${l}`)
            .join("\n")}
        </pre>
      ) : null}
      {newStr ? (
        <pre className="whitespace-pre-wrap bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-400">
          {newStr
            .split("\n")
            .map((l) => `+ ${l}`)
            .join("\n")}
        </pre>
      ) : null}
    </div>
  );
}

/**
 * 진행 로그(도구 이벤트 배열)에서 편집·작성된 파일 경로 목록을 추출한다(중복 제거·순서 보존).
 * claude-desktop식 "편집된 파일 N개" 요약용. 채팅·이슈 공용.
 */
export function editedFilesFromLog(
  log: { name?: string; input?: string; detail?: string }[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ev of log) {
    if (!ev.name || !isFileTool(ev.name)) continue;
    const path = parseInput(ev.input).filePath;
    if (path && !seen.has(path)) {
      seen.add(path);
      out.push(path);
    }
  }
  return out;
}

/** 파일 경로에서 파일명만 노출(공용). */
export function fileBasename(p: string): string {
  return basename(p);
}

/**
 * 도구 사용 칩(claude-desktop식). 접으면 아이콘 + "편집 foo.ts" 한 줄,
 * 펼치면 편집은 diff, 작성은 내용, bash는 명령어, 그 외는 원본 input.
 * 채팅 타임라인과 이슈 진행 내역에서 공통 사용한다.
 */
export function ToolPart({ name, input }: { name: string; input?: string }) {
  const [open, setOpen] = useState(false);
  const { label, icon: Icon } = metaFor(name);
  const parsed = parseInput(input);
  const target = targetLabel(name, parsed, undefined);
  const hasBody = Boolean(input);

  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border bg-background/40 text-xs">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-left text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        title={target ?? name}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <Icon className="size-3.5 shrink-0" />
        {label ? (
          <span className="shrink-0 font-medium text-foreground/80">{label}</span>
        ) : (
          <span className="shrink-0 font-mono">{name}</span>
        )}
        {target && (
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
            {target}
          </span>
        )}
      </button>
      {open && hasBody && (
        <div className="border-t border-border">
          {isFileTool(name) && parsed.filePath && (
            <div className="break-all px-2.5 pt-2 font-mono text-[11px] text-muted-foreground">
              {parsed.filePath}
            </div>
          )}
          {/* Edit: old→new diff */}
          {(parsed.oldString || parsed.newString) && (
            <div className="px-2.5 py-2">
              <DiffBlock oldStr={parsed.oldString} newStr={parsed.newString} />
            </div>
          )}
          {/* MultiEdit: 여러 diff */}
          {parsed.edits && parsed.edits.length > 0 && (
            <div className="space-y-2 px-2.5 py-2">
              {parsed.edits.map((e, i) => (
                <DiffBlock key={i} oldStr={e.oldString} newStr={e.newString} />
              ))}
            </div>
          )}
          {/* Write: 작성 내용 */}
          {parsed.content && !parsed.oldString && !parsed.edits && (
            <pre className="overflow-x-auto whitespace-pre-wrap bg-emerald-500/5 px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
              {parsed.content}
            </pre>
          )}
          {/* Bash: 명령어 */}
          {parsed.command && (
            <pre className="overflow-x-auto whitespace-pre-wrap px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
              <span className="select-none text-muted-foreground/60">$ </span>
              {parsed.command}
            </pre>
          )}
          {/* 폴백: 알려진 필드가 없으면 원본 JSON */}
          {!parsed.oldString &&
            !parsed.edits &&
            !parsed.content &&
            !parsed.command && (
              <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
                {input}
              </pre>
            )}
        </div>
      )}
    </div>
  );
}
