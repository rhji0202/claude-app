"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Claude Code CLI 트랜스크립트 렌더러(채팅 전용).
 *
 * 말풍선·아바타 없이 CLI 출력 그대로를 흉내낸다:
 *   `>`  사용자 입력       `⏺`  에이전트 발화·도구 호출
 *   `⎿`  도구 실행 결과     `✻`  진행 중 스피너
 *
 * `/issues`의 ToolPart(칩 스타일)와는 의도적으로 별개다 — 이슈 진행 내역은
 * 기존 카드 UI를 유지하므로 공용화하지 않는다.
 */

/** 도구명 → CLI가 쓰는 표기. 미매핑·MCP 도구는 원래 이름 그대로 노출한다. */
const TOOL_LABEL: Record<string, string> = {
  Edit: "Edit",
  MultiEdit: "MultiEdit",
  Write: "Write",
  NotebookEdit: "NotebookEdit",
  Read: "Read",
  Bash: "Bash",
  Grep: "Grep",
  Glob: "Glob",
  WebFetch: "WebFetch",
  WebSearch: "WebSearch",
  TodoWrite: "TodoWrite",
  Task: "Task",
};

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

function parseInput(raw: string | undefined): ParsedInput {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const str = (k: string) =>
      typeof o[k] === "string" ? (o[k] as string) : undefined;
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
      prompt: str("prompt") ?? str("description"),
      oldString: str("old_string"),
      newString: str("new_string"),
      content: str("content") ?? str("new_source"),
      edits,
    };
  } catch {
    return {};
  }
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** CLI의 `Tool(인자)` 괄호 안 요약. 없으면 빈 문자열. */
function argSummary(p: ParsedInput): string {
  if (p.filePath) return basename(p.filePath);
  if (p.command) return p.command;
  if (p.pattern) return p.pattern;
  if (p.url) return p.url;
  if (p.prompt) return p.prompt;
  return "";
}

/** 편집 도구의 +N -N 라인 수. diff 정보가 없으면 null. */
function diffStat(p: ParsedInput): { added: number; removed: number } | null {
  const countLines = (s: string) => (s ? s.split("\n").length : 0);
  if (p.edits?.length) {
    return p.edits.reduce(
      (acc, e) => ({
        added: acc.added + countLines(e.newString),
        removed: acc.removed + countLines(e.oldString),
      }),
      { added: 0, removed: 0 },
    );
  }
  if (p.oldString !== undefined || p.newString !== undefined) {
    return {
      added: countLines(p.newString ?? ""),
      removed: countLines(p.oldString ?? ""),
    };
  }
  if (p.content !== undefined) return { added: countLines(p.content), removed: 0 };
  return null;
}

/**
 * `⎿` 결과 줄에 쓸 한 줄 요약.
 * 실제 실행 결과(result)가 있으면 그 첫 줄을 쓰고, 없으면 입력에서 유추한다.
 */
function resultSummary(
  parsed: ParsedInput,
  result: string | undefined,
  isError: boolean,
): string {
  if (result !== undefined && result !== "") {
    const firstLine = result.split("\n").find((l) => l.trim()) ?? "";
    const trimmed = firstLine.trim();
    return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
  }
  if (isError) return "오류";
  const stat = diffStat(parsed);
  if (stat) return `+${stat.added} -${stat.removed}`;
  return "실행 중…";
}

/**
 * 토큰 수를 k 단위로. CLI처럼 짧게 — 상태줄이 숫자로 밀리지 않게 한다.
 * 1000 미만은 그대로, 1k~10k는 소수 첫째 자리(9.8k), 10k 이상은 정수(42k).
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  // 10k 미만은 해상도가 필요하지만 9.0k처럼 불필요한 .0은 붙이지 않는다.
  if (k < 10) {
    const s = k.toFixed(1);
    return `${s.endsWith(".0") ? s.slice(0, -2) : s}k`;
  }
  return `${Math.round(k)}k`;
}

/**
 * 서브에이전트 진행 요약 한 줄.
 * summary(AI 생성)가 있으면 그걸 쓰고, 없으면 토큰·도구 호출 수로 대체한다.
 */
function agentSummary(agent: {
  tokens?: number;
  toolUses?: number;
  lastToolName?: string;
  summary?: string;
}): string {
  if (agent.summary) return agent.summary;
  const bits: string[] = [];
  if (agent.toolUses) bits.push(`도구 ${agent.toolUses}회`);
  if (agent.tokens) bits.push(`${formatTokens(agent.tokens)} 토큰`);
  if (agent.lastToolName) bits.push(agent.lastToolName);
  return bits.length > 0 ? bits.join(" · ") : "실행 중…";
}

/** old→new diff 블록. CLI처럼 `-`/`+` 접두. */
function DiffBlock({ oldStr, newStr }: { oldStr?: string; newStr?: string }) {
  const lines = (s: string, sign: string) =>
    s.split("\n").map((l) => `${sign} ${l}`).join("\n");
  return (
    <>
      {oldStr ? (
        <pre className="whitespace-pre-wrap text-destructive">
          {lines(oldStr, "-")}
        </pre>
      ) : null}
      {newStr ? (
        <pre className="whitespace-pre-wrap text-success">
          {lines(newStr, "+")}
        </pre>
      ) : null}
    </>
  );
}

/**
 * 도구 호출 한 건 — `⏺ Bash(pnpm test)` + `⎿ 결과` 두 줄.
 * 클릭하면 전체 diff·명령어·원본 결과를 펼친다.
 */
function ToolLine({
  name,
  input,
  result,
  resultIsError,
  elapsedSeconds,
  agent,
  children,
}: {
  name: string;
  input?: string;
  result?: string;
  resultIsError?: boolean;
  elapsedSeconds?: number;
  /** 서브에이전트 하위 트랜스크립트. 있으면 이 줄 아래에 들여써서 렌더한다. */
  children?: ReactNode;
  agent?: {
    description: string;
    agentType?: string;
    tokens?: number;
    toolUses?: number;
    lastToolName?: string;
    summary?: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const parsed = parseInput(input);
  const label = TOOL_LABEL[name] ?? name;
  // 서브에이전트는 도구 input보다 description이 더 유용한 헤더 인자다.
  const arg = agent?.description || argSummary(parsed);
  const isError = resultIsError === true;
  // React는 빈 배열·false도 children으로 넘기므로 실제 렌더될 내용이 있는지 본다.
  const hasChildren = Boolean(
    Array.isArray(children) ? children.some(Boolean) : children,
  );
  const summary =
    // 결과 전이고 서브에이전트면 진행 상황을 `⎿` 줄에 쓴다.
    // (agent 메타가 아직 안 왔어도 하위 내역이 있으면 실행 중이다)
    result === undefined && (agent || hasChildren)
      ? agentSummary(agent ?? {})
      : resultSummary(parsed, result, isError);
  // 기본은 접힘 — `⎿` 줄의 진행 요약만 보이고, 클릭하면 내역이 펼쳐진다.
  const hasDetail = Boolean(input) || Boolean(result) || hasChildren;
  // 결과가 오기 전까지만 경과 시간을 노출한다(완료된 도구에 초를 남기지 않는다).
  const showElapsed =
    result === undefined && elapsedSeconds !== undefined && elapsedSeconds >= 1;

  return (
    <div className="min-w-0">
      <button
        type="button"
        className="flex w-full min-w-0 items-start gap-2 rounded py-0.5 text-left hover:bg-secondary/40"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
      >
        <span className="shrink-0 select-none text-accent">⏺</span>
        <span className="min-w-0 flex-1">
          <span className="text-foreground">{label}</span>
          {/* 펼칠 수 있는 줄임을 알린다(접힌 상태에서 특히 필요) */}
          {hasDetail && (
            <ChevronRight
              className={cn(
                "ml-1 inline-block size-3 shrink-0 align-middle text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
              aria-hidden
            />
          )}
          {agent?.agentType && (
            <span className="ml-1.5 rounded bg-secondary px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {agent.agentType}
            </span>
          )}
          {arg && (
            // 헤더는 한 줄 유지 — 긴 명령·경로는 잘라내고 펼치면 전체를 보여준다.
            // (모바일에서 break-all로 여러 줄이 되면 트랜스크립트가 읽기 어려워진다)
            <span className="text-muted-foreground">
              (
              <span className="inline-block max-w-full truncate align-bottom text-foreground/70">
                {arg}
              </span>
              )
            </span>
          )}
          {showElapsed && (
            <span className="ml-1.5 tabular-nums text-muted-foreground">
              {Math.floor(elapsedSeconds!)}s
            </span>
          )}
        </span>
      </button>
      {/* 하위 내역을 펼쳐 놓은 동안에는 `⎿ 진행 요약`이 중복이라 감춘다.
          접힌 상태에서는 이 줄이 유일한 상태 표시이므로 항상 보여준다. */}
      {(!hasChildren || !open || result !== undefined) && (
        <div className="flex min-w-0 items-start gap-2 pl-2">
          <span className="shrink-0 select-none text-muted-foreground">⎿</span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              isError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {summary}
          </span>
        </div>
      )}
      {/* 서브에이전트 하위 트랜스크립트 — 세로선으로 소속을 표시한다 */}
      {hasChildren && open && (
        <div className="ml-2 min-w-0 space-y-1 border-l border-border pl-3">
          {children}
        </div>
      )}
      {open && hasDetail && (
        // 좁은 폭에서도 가로 스크롤이 페이지로 새지 않도록 줄바꿈으로 담는다.
        // (긴 URL·minified 출력 같은 끊기지 않는 토큰까지 break-words로 처리)
        <div className="mt-1 max-w-full space-y-1 overflow-hidden border-l border-border pl-3 text-[11px] leading-relaxed [&_pre]:break-words">
          {parsed.filePath && (
            <div className="break-all text-muted-foreground">{parsed.filePath}</div>
          )}
          {(parsed.oldString || parsed.newString) && (
            <DiffBlock oldStr={parsed.oldString} newStr={parsed.newString} />
          )}
          {parsed.edits?.map((e, i) => (
            <DiffBlock key={i} oldStr={e.oldString} newStr={e.newString} />
          ))}
          {parsed.content && !parsed.oldString && !parsed.edits && (
            <pre className="whitespace-pre-wrap text-success">{parsed.content}</pre>
          )}
          {parsed.command && (
            <pre className="whitespace-pre-wrap text-foreground/80">
              <span className="select-none text-muted-foreground">$ </span>
              {parsed.command}
            </pre>
          )}
          {result && (
            <pre
              className={cn(
                "whitespace-pre-wrap",
                isError ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** 진행 중 표시 — CLI의 회전 커서 자리. */
export function ThinkingLine() {
  return (
    <div className="flex items-center gap-2">
      <span className="animate-pulse select-none text-accent">✻</span>
      <span className="text-muted-foreground">작업 중…</span>
    </div>
  );
}

/** 사용자 입력 줄 — CLI의 `>` 프롬프트 에코. */
export function UserLine({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="shrink-0 select-none text-accent">&gt;</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">
        {text}
      </span>
    </div>
  );
}

/** 에이전트 발화 줄 — `⏺` + 본문. 마크다운은 쓰지 않고 CLI처럼 평문 유지. */
export function AssistantLine({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="shrink-0 select-none text-accent">⏺</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/90">
        {text}
      </span>
    </div>
  );
}

export { ToolLine };
