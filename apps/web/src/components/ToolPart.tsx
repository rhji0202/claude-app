"use client";

import {
  Bot,
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
 * 도구 호출 표시 도우미(채팅·이슈 공용): 도구명 → 진행 문구·아이콘,
 * 입력(JSON) 해석, 펼침 상세(diff·명령어·결과).
 * SDK 도구명 규칙(Edit/Write/Read/Bash/Grep/Glob/WebFetch/WebSearch/TodoWrite/Task).
 * MCP 도구(mcp__…)나 미매핑 도구는 기본(렌치)과 원래 이름으로 떨어진다.
 */
const TOOL_META: Record<string, { active: string; done: string; icon: LucideIcon }> = {
  Edit: { active: "파일 편집 중", done: "파일 편집함", icon: FilePen },
  MultiEdit: { active: "파일 편집 중", done: "파일 편집함", icon: FilePen },
  Write: { active: "파일 작성 중", done: "파일 작성함", icon: FilePlus },
  NotebookEdit: { active: "노트북 편집 중", done: "노트북 편집함", icon: FilePen },
  Read: { active: "파일 읽는 중", done: "파일 읽음", icon: FileText },
  Bash: { active: "명령 실행 중", done: "명령 실행함", icon: Terminal },
  Grep: { active: "코드 검색 중", done: "코드 검색함", icon: Search },
  Glob: { active: "파일 찾는 중", done: "파일 찾음", icon: Search },
  WebFetch: { active: "웹 페이지 가져오는 중", done: "웹 페이지 가져옴", icon: Globe },
  WebSearch: { active: "웹 검색 중", done: "웹 검색함", icon: Globe },
  TodoWrite: { active: "할 일 정리 중", done: "할 일 정리함", icon: ListTodo },
  Task: { active: "서브에이전트 실행 중", done: "서브에이전트 실행함", icon: Bot },
};

/** 도구의 진행/완료 문구와 아이콘. 미매핑 도구는 이름 그대로 쓴다. */
export function toolCopy(name: string): { active: string; done: string; icon: LucideIcon } {
  return (
    TOOL_META[name] ?? { active: `${name} 실행 중`, done: `${name} 실행함`, icon: Wrench }
  );
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
  prompt?: string;
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
      prompt: str("description") ?? str("prompt"),
      oldString: str("old_string"),
      newString: str("new_string"),
      content: str("content") ?? str("new_source"),
      edits,
    };
  } catch {
    return {};
  }
}

/** 도구 대상 요약("foo.ts", "npm test" 등). 입력이 JSON이 아니면 원문(요약 문자열)을 쓴다. */
export function toolTarget(input: string | undefined): string | null {
  const p = parseInput(input);
  if (p.filePath) return basename(p.filePath);
  if (p.command) return p.command;
  if (p.pattern) return p.pattern;
  if (p.url) return p.url;
  if (p.prompt) return p.prompt;
  if (input && !input.trimStart().startsWith("{")) return input;
  return null;
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
 * 도구 호출 펼침 상세: 편집은 diff, 작성은 내용, bash는 명령어, 그 외는 원본 input.
 * 실행 결과(result)가 있으면 아래에 붙인다. 보여줄 게 없으면 null.
 */
export function ToolDetail({
  name,
  input,
  result,
  isError,
}: {
  name: string;
  input?: string;
  result?: string;
  isError?: boolean;
}) {
  if (!input && !result) return null;
  const parsed = parseInput(input);
  const known = parsed.oldString || parsed.edits || parsed.content || parsed.command;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-md border border-border bg-background/40 py-1.5 [&_pre]:break-words">
      {isFileTool(name) && parsed.filePath && (
        <div className="break-all px-2.5 font-mono text-[11px] text-muted-foreground">
          {parsed.filePath}
        </div>
      )}
      {(parsed.oldString || parsed.newString) && (
        <div className="px-2.5">
          <DiffBlock oldStr={parsed.oldString} newStr={parsed.newString} />
        </div>
      )}
      {parsed.edits && parsed.edits.length > 0 && (
        <div className="space-y-2 px-2.5">
          {parsed.edits.map((e, i) => (
            <DiffBlock key={i} oldStr={e.oldString} newStr={e.newString} />
          ))}
        </div>
      )}
      {parsed.content && !parsed.oldString && !parsed.edits && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-emerald-500/5 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          {parsed.content}
        </pre>
      )}
      {parsed.command && (
        <pre className="overflow-x-auto whitespace-pre-wrap px-2.5 font-mono text-[11px] text-muted-foreground">
          <span className="select-none text-muted-foreground/60">$ </span>
          {parsed.command}
        </pre>
      )}
      {/* 폴백: 알려진 필드가 없으면 원본 입력 */}
      {input && !known && (
        <pre className="overflow-x-auto whitespace-pre-wrap px-2.5 font-mono text-[11px] text-muted-foreground">
          {input}
        </pre>
      )}
      {result && (
        <pre
          className={cn(
            "max-h-64 overflow-auto whitespace-pre-wrap border-t border-border px-2.5 pt-1.5 font-mono text-[11px]",
            isError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {result}
        </pre>
      )}
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
