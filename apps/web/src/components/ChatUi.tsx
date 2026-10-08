"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Copy,
  FilePen,
  Loader2,
  MessageSquare,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ToolDetail,
  editedFilesFromLog,
  fileBasename,
  toolCopy,
  toolTarget,
} from "@/components/ToolPart";

/**
 * 대화형 UI 조각(채팅·이슈 실행 화면 공용) — 사용자 말풍선, 답변 아래 동작 줄,
 * 그리고 ChatGPT·Claude식 진행 표시(AiProgress): 작업 중에는 한 줄 상태와 경과 시간,
 * 끝나면 "N초 동안 작업함" 요약을 보여 주고 눌러서 단계를 타임라인으로 펼친다.
 */

/** 진행 단계: 에이전트의 중간 발화 또는 도구 호출(서브에이전트는 하위 단계를 가진다). */
export type ProgressStep =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      name: string;
      input?: string;
      result?: string;
      isError?: boolean;
      elapsedSeconds?: number;
      agent?: {
        description: string;
        agentType?: string;
        tokens?: number;
        toolUses?: number;
        summary?: string;
      };
      children?: ProgressStep[];
    };

/**
 * 토큰 수를 k 단위로 — 상태줄이 숫자로 밀리지 않게 한다.
 * 1000 미만은 그대로, 1k~10k는 소수 첫째 자리(9.8k), 10k 이상은 정수(42k).
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k < 10) {
    const s = k.toFixed(1);
    return `${s.endsWith(".0") ? s.slice(0, -2) : s}k`;
  }
  return `${Math.round(k)}k`;
}

/** 진행 중 경과 시간(초). 1초마다 갱신한다. */
function useElapsed(startedAt: number | undefined, live: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return live && startedAt !== undefined
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : null;
}

function toolSteps(steps: ProgressStep[]) {
  return steps.filter((s): s is Extract<ProgressStep, { kind: "tool" }> => s.kind === "tool");
}

/** 서브에이전트 진행 한 줄. AI 요약이 있으면 그걸, 없으면 도구·토큰 수. */
function agentSummary(agent: NonNullable<Extract<ProgressStep, { kind: "tool" }>["agent"]>) {
  if (agent.summary) return agent.summary;
  const bits: string[] = [];
  if (agent.toolUses) bits.push(`도구 ${agent.toolUses}회`);
  if (agent.tokens) bits.push(`${formatTokens(agent.tokens)} 토큰`);
  return bits.join(" · ");
}

function StepRow({ step, running }: { step: ProgressStep; running: boolean }) {
  const [open, setOpen] = useState(false);

  if (step.kind === "text") {
    return (
      <li className="relative flex gap-3 pb-4 last:pb-0">
        <span className="relative z-10 flex size-5 shrink-0 items-center justify-center bg-background text-muted-foreground">
          <MessageSquare className="size-3.5" aria-hidden />
        </span>
        <p className="max-h-48 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap pt-0.5 text-xs leading-relaxed text-muted-foreground">
          {step.text.trim()}
        </p>
      </li>
    );
  }

  const copy = toolCopy(step.name);
  const Icon = copy.icon;
  const failed = step.isError === true;
  const target = step.agent?.description || toolTarget(step.input);
  const detail = step.input || step.result;
  const hasChildren = Boolean(step.children?.length);
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span
        className={cn(
          "relative z-10 flex size-5 shrink-0 items-center justify-center bg-background",
          failed ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {running ? (
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : failed ? (
          <X className="size-3.5" aria-hidden />
        ) : (
          <Icon className="size-3.5" aria-hidden />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <button
          type="button"
          className={cn(
            "flex min-h-5 min-w-0 items-center gap-x-2 text-left text-xs",
            detail || hasChildren ? "cursor-pointer" : "cursor-default",
          )}
          onClick={() => (detail || hasChildren) && setOpen((v) => !v)}
          aria-expanded={detail || hasChildren ? open : undefined}
        >
          <span
            className={cn(
              "shrink-0 font-medium",
              running && "shimmer-text",
              failed && "text-destructive",
            )}
          >
            {running ? copy.active : copy.done}
            {failed && " 실패"}
          </span>
          {target && (
            <span className="min-w-0 truncate text-muted-foreground" title={target}>
              {target}
            </span>
          )}
          {running && step.elapsedSeconds !== undefined && step.elapsedSeconds >= 1 && (
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {Math.floor(step.elapsedSeconds)}초
            </span>
          )}
        </button>
        {step.agent && agentSummary(step.agent) && (
          <span className="text-xs text-muted-foreground">{agentSummary(step.agent)}</span>
        )}
        {open && hasChildren && (
          <ol className="relative mt-1">
            <span aria-hidden className="absolute bottom-2.5 left-2.5 top-2.5 w-px bg-border" />
            {step.children!.map((child, i) => (
              <StepRow
                key={i}
                step={child}
                running={running && child.kind === "tool" && child.result === undefined}
              />
            ))}
          </ol>
        )}
        {open && detail && (
          <ToolDetail
            name={step.name}
            input={step.input}
            result={step.result}
            isError={step.isError}
          />
        )}
      </div>
    </li>
  );
}

/**
 * 실행 중인 도구 판정. tracksResults가 false면(이슈 진행 로그처럼 도구 결과가 없는 경우)
 * 마지막 도구만 진행 중으로 본다.
 */
function runningPredicate(steps: ProgressStep[], tracksResults: boolean) {
  const tools = toolSteps(steps);
  const lastTool = tools[tools.length - 1];
  return (s: ProgressStep) =>
    s.kind === "tool" && s.result === undefined && (tracksResults || s === lastTool);
}

/**
 * 작업 중 한 줄 상태: 지금 하는 일의 종류만(예: "명령 실행 중").
 * 대상(명령어·파일)은 길고 펼친 단계에 이미 나오므로 붙이지 않는다.
 */
export function liveStatus(steps: ProgressStep[], tracksResults = true): string {
  const isRunning = runningPredicate(steps, tracksResults);
  const current = [...toolSteps(steps)].reverse().find(isRunning);
  if (current) return toolCopy(current.name).active;
  const last = steps[steps.length - 1];
  return last?.kind === "text" ? "답변을 정리하는 중" : "작업을 시작하는 중";
}

/**
 * 진행 표시. tracksResults가 false면(이슈 진행 로그처럼 도구 결과가 없는 경우)
 * 실행 중일 때 마지막 도구만 진행 중으로 본다.
 */
export function AiProgress({
  steps,
  live,
  startedAt,
  endedAt,
  tracksResults = true,
}: {
  steps: ProgressStep[];
  live: boolean;
  startedAt?: number;
  endedAt?: number;
  tracksResults?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const elapsed = useElapsed(startedAt, live);

  if (!live && steps.length === 0) return null;

  const tools = toolSteps(steps);
  const running = runningPredicate(steps, tracksResults);
  const isRunning = (s: ProgressStep) => live && running(s);

  // 한 줄 상태: 작업 중이면 지금 하는 일, 끝났으면 요약.
  let label: string;
  if (live) {
    label = liveStatus(steps, tracksResults);
  } else if (startedAt !== undefined && endedAt !== undefined) {
    label = `${Math.max(1, Math.round((endedAt - startedAt) / 1000))}초 동안 작업함`;
  } else {
    label = tools.length > 0 ? `도구 ${tools.length}회 사용함` : `작업 과정 ${steps.length}단계`;
  }

  const edited = editedFilesFromLog(tools);
  const expandable = steps.length > 0;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        className={cn(
          "flex max-w-full items-center gap-1.5 self-start rounded-md py-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground",
          expandable ? "cursor-pointer" : "cursor-default",
        )}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable ? panelId : undefined}
        disabled={!expandable}
        onClick={() => setOpen((v) => !v)}
      >
        <span role="status" className={cn("min-w-0 truncate", live && "shimmer-text")}>
          {label}
        </span>
        {elapsed !== null && elapsed > 0 && (
          <span className="shrink-0 tabular-nums opacity-70">{elapsed}초</span>
        )}
        {expandable && (
          <ChevronRight
            className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
            aria-hidden
          />
        )}
      </button>

      {edited.length > 0 && (
        <div
          className="mt-1 flex min-w-0 items-center gap-1.5 self-start rounded-md border border-border bg-secondary/30 px-2.5 py-1.5 text-xs"
          title={edited.join("\n")}
        >
          <FilePen className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-medium">편집된 파일 {edited.length}개</span>
          <span className="min-w-0 truncate font-mono text-muted-foreground">
            {edited.map((f) => fileBasename(f)).join(", ")}
          </span>
        </div>
      )}

      {open && expandable && (
        <ol id={panelId} className="relative mb-1 ml-0.5 mt-2">
          {/* 단계를 잇는 세로선 */}
          <span aria-hidden className="absolute bottom-2.5 left-2.5 top-2.5 w-px bg-border" />
          {steps.map((step, i) => (
            <StepRow key={i} step={step} running={isRunning(step)} />
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * 사용자 말풍선(오른쪽 정렬). 첨부 등은 children 밖 extra로 말풍선 위에 둔다.
 * 기본은 진한 primary(채팅 평문). 마크다운을 담는 말풍선(이슈 본문 등)은 링크·코드가
 * 배경에 묻히지 않도록 muted를 쓴다.
 */
export function UserBubble({
  children,
  extra,
  muted = false,
}: {
  children?: ReactNode;
  extra?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-start justify-end gap-3">
      <div className="flex min-w-0 flex-1 flex-col items-end gap-2">
        {extra}
        {children && (
          <div
            className={cn(
              "max-w-[85%] min-w-0 break-words rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm",
              muted
                ? "bg-secondary text-secondary-foreground"
                : "bg-primary text-primary-foreground",
            )}
          >
            {children}
          </div>
        )}
      </div>
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
        aria-label="질문"
      >
        <User className="size-4" aria-hidden />
      </span>
    </div>
  );
}

/** 에이전트 답변 줄: 왼쪽 아이콘 + 내용(진행 표시·답변·결정 카드 등). */
export function AssistantBlock({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
        aria-label="답변"
      >
        <Bot className="size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </div>
  );
}

/** 답변 아래 동작 줄: 복사. */
export function AnswerActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Button
        size="icon"
        variant="ghost"
        className="size-8 md:size-7"
        aria-label="복사"
        onClick={() => void copy()}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

/** 대화가 비었을 때 가운데 안내. */
export function ChatEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center text-muted-foreground">
      <div className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
        <Bot className="size-6" />
      </div>
      <p className="text-base font-medium text-foreground">{title}</p>
      {hint && <p className="text-xs">{hint}</p>}
    </div>
  );
}
