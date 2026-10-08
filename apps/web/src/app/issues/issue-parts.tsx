"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Loader2,
  MessagesSquare,
  Paperclip,
  ShieldQuestion,
} from "lucide-react";
import type {
  IssueAttachment,
  IssueInterview,
  IssueMode,
  IssueProgressEvent,
  IssueTask,
} from "@claude-app/shared";
import { issueStatusLabel } from "@claude-app/shared";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Markdown";
import {
  AiProgress,
  AnswerActions,
  AssistantBlock,
  UserBubble,
  liveStatus,
  type ProgressStep,
} from "@/components/ChatUi";
import { api, upload, uploadUrl } from "@/lib/api";

/**
 * 이슈 목록(page.tsx)과 실행 화면(IssueRunView)이 함께 쓰는 조각.
 * Next 페이지 파일은 default 외 export를 둘 수 없어 여기로 뺐다.
 */

/**
 * 상태 배지 문구. 분석 후 진행은 결정 대기·실행 중을 단계에 맞게 구체화한다
 * (인터뷰 대기·기획 검토·분석 중). 그 밖에는 공용 상태 라벨.
 */
export function issueStateLabel(issue: Pick<IssueTask, "status" | "mode" | "planStage">) {
  if (issue.status === "needs_decision" && issue.planStage === "interview") return "인터뷰 대기";
  if (issue.status === "needs_decision" && issue.planStage === "review") return "기획 검토";
  if (issue.status === "running" && issue.mode === "plan" && issue.planStage !== "approved")
    return "분석 중";
  return issueStatusLabel(issue.status);
}

/** 처리 모드 고르기(바로 처리 / 분석 후 진행). 가져오기·등록·확인창이 함께 쓴다. */
export function ModePicker({
  value,
  onChange,
}: {
  value: IssueMode;
  onChange: (mode: IssueMode) => void;
}) {
  const options: { mode: IssueMode; label: string; hint: string }[] = [
    { mode: "direct", label: "바로 처리", hint: "에이전트가 곧바로 작업합니다." },
    {
      mode: "plan",
      label: "분석 후 진행",
      hint: "먼저 분석해 질문하고, 답으로 정한 기획안을 승인하면 작업합니다.",
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="처리 방식">
      {options.map((o) => (
        <button
          key={o.mode}
          type="button"
          role="radio"
          aria-checked={value === o.mode}
          onClick={() => onChange(o.mode)}
          className={cn(
            "cursor-pointer rounded-lg border p-3 text-left text-sm transition-colors",
            value === o.mode
              ? "border-[var(--accent)] bg-[var(--accent)]/10"
              : "border-border hover:bg-muted",
          )}
        >
          <div className="font-medium">{o.label}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{o.hint}</div>
        </button>
      ))}
    </div>
  );
}

/**
 * 이미지가 아닌 파일(엑셀·PDF 등) 첨부 컨트롤. 등록 폼·실행 화면이 공유한다.
 * 업로드 즉시 이슈 files[]에 쌓이므로, 다음 실행 때 에이전트 작업 디렉터리로 복사된다.
 *
 * ensureIssue: 업로드 대상 이슈 id를 확보한다(등록 폼은 첫 업로드 시 이슈를 생성).
 */
export function FileAttach({
  ensureIssue,
  attached,
  onAttached,
}: {
  ensureIssue: () => Promise<string>;
  attached: IssueAttachment[];
  onAttached: (files: IssueAttachment[]) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleFiles(picked: File[]) {
    if (picked.length === 0) return;
    setBusy(true);
    try {
      const id = await ensureIssue();
      const form = new FormData();
      for (const f of picked) form.append("files", f);
      const res = await upload<{ files: IssueAttachment[] }>(
        `/issues/${id}/files`,
        form,
      );
      onAttached(res.files);
      toast.success(`파일 ${picked.length}개를 첨부했습니다.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
        <Paperclip className="size-3.5" />
        {busy ? "업로드 중..." : "파일 첨부 (엑셀·PDF 등)"}
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </label>
      {attached.length > 0 && (
        <ul className="space-y-1 text-xs">
          {attached.map((f) => (
            <li key={f.url} className="flex items-center gap-1.5">
              <Paperclip className="size-3 shrink-0 text-muted-foreground" />
              <a
                href={uploadUrl(f.url)}
                target="_blank"
                rel="noreferrer"
                className="truncate underline underline-offset-2"
              >
                {f.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 에이전트가 남긴 결정 질문을 구조로 읽은 결과. */
export type DecisionQuestion = {
  question: string;
  reason: string | null;
  options: { key: string; label: string; detail: string | null }[];
  recommended: string | null;
};

/**
 * 결정 대기 질문(`질문:` / `이유:` / `A) 이름 — 설명` / `추천:`)을 구조로 파싱한다.
 * 규약을 따르지 않는 옛 질문은 null을 돌려 원문 렌더로 폴백한다.
 */
export function parseDecisionQuestion(text: string): DecisionQuestion | null {
  let question = "";
  let reason: string | null = null;
  let recommended: string | null = null;
  const options: DecisionQuestion["options"] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("```")) continue;
    if (line.startsWith("질문:")) {
      question = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("이유:")) {
      reason = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("추천:")) {
      recommended = line.slice(3).trim().match(/[A-Z]/)?.[0] ?? null;
      continue;
    }
    // `A) 이름 — 설명` — 구분자는 em dash(—) 또는 하이픈을 허용한다.
    const opt = line.match(/^([A-Z])\)\s*(.+)$/);
    if (opt) {
      const [label, detail] = opt[2].split(/\s+[—–-]\s+/);
      options.push({
        key: opt[1],
        label: label.trim(),
        detail: detail?.trim() ?? null,
      });
    }
  }
  if (!question && options.length === 0) return null;
  return { question, reason, options, recommended };
}

/**
 * 결정 대기 카드: 에이전트 질문을 선택지 카드로 보여준다(규약을 어긴 옛 질문은 원문).
 * 선택지를 누르면 onPick으로 지시 문구를 넘긴다 — 재개는 사람이 직접 누른다.
 * GitHub 이슈에서 온 이슈면 결정권자에게 GitHub 코멘트로 물어볼 수 있다.
 */
export function DecisionCard({
  issueId,
  question,
  canAskGithub,
  initialAskedUrl,
  onPick,
  onChanged,
}: {
  issueId: string;
  question: string;
  canAskGithub: boolean;
  initialAskedUrl: string | null;
  onPick: (memo: string) => void;
  onChanged?: () => void;
}) {
  const decision = parseDecisionQuestion(question);
  const [picked, setPicked] = useState<string | null>(null);
  // 결정 질문을 GitHub 이슈에 물어본 코멘트 URL(있으면 중복 게시 대신 링크를 보여준다).
  const [askedUrl, setAskedUrl] = useState<string | null>(initialAskedUrl);
  const [busy, setBusy] = useState(false);

  /**
   * 결정 질문을 GitHub 이슈 코멘트로 물어본다.
   * 답변은 자동으로 회수하지 않는다 — 답글을 읽고 아래 입력란에 정리해 넣는다.
   */
  async function askOnGithub() {
    setBusy(true);
    try {
      const next = await api.post<{ decisionCommentUrl?: string | null }>(
        `/issues/${issueId}/decision-comment`,
      );
      setAskedUrl(next.decisionCommentUrl ?? null);
      onChanged?.();
      toast.success("GitHub 이슈에 질문을 남겼습니다.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--accent)]/40 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldQuestion className="size-4 text-[var(--accent)]" />
        결정이 필요합니다
      </div>
      {decision ? (
        <>
          {decision.question && (
            <div className="text-base font-medium leading-snug">{decision.question}</div>
          )}
          {decision.reason && (
            <p className="text-sm text-muted-foreground">{decision.reason}</p>
          )}
          {decision.options.length > 0 && (
            <div className="flex flex-col gap-2">
              {decision.options.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => {
                    setPicked(o.key);
                    onPick(`${o.key}) ${o.label} 선택합니다. 이 방향으로 진행해 주세요.`);
                  }}
                  className={`w-full cursor-pointer rounded-md border p-3 text-left text-sm transition-colors ${
                    picked === o.key
                      ? "border-[var(--accent)] bg-[var(--accent)]/10"
                      : "border-border bg-background hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {o.key}) {o.label}
                    </span>
                    {decision.recommended === o.key && <Badge variant="success">추천</Badge>}
                  </div>
                  {o.detail && (
                    <div className="mt-1 text-xs text-muted-foreground">{o.detail}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <Markdown className="markdown-body">
          {question}
        </Markdown>
      )}
      {/* 결정 권한이 다른 사람에게 있으면 이 질문을 GitHub 이슈로 물어본다.
          수동 이슈(issueNumber 없음)는 게시할 곳이 없어 감춘다. */}
      {canAskGithub && (
        <div className="border-t border-[var(--accent)]/20 pt-3">
          {askedUrl ? (
            <div className="text-xs text-muted-foreground">
              이 질문을 GitHub 이슈에 남겼습니다 —{" "}
              <a href={askedUrl} target="_blank" rel="noreferrer" className="underline">
                코멘트 보기
              </a>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={askOnGithub}
              disabled={busy}
              title="이 질문을 GitHub 이슈 코멘트로 남깁니다. 답글은 자동으로 반영되지 않으므로, 답을 읽고 아래 입력란에 정리해 넣으세요."
            >
              GitHub 이슈에 물어보기
            </Button>
          )}
        </div>
      )}
      <p className="border-t border-[var(--accent)]/20 pt-2 text-xs text-muted-foreground">
        답을 정하기 어려우면 <b>대화로 이어가기</b>로 에이전트와 상의할 수 있습니다. 이슈가
        작업하던 브랜치를 이어받은 전용 작업 공간에서 열리므로, 고친 내용을 보면서 물어볼 수
        있습니다.
      </p>
    </section>
  );
}

/** 첫 사용자 말풍선: 이슈 제목·본문·추가 지시, 그 위에 첨부(이미지·파일). */
export function IssueBubble({ issue }: { issue: IssueTask }) {
  // 본문 이미지 치환용 맵: 서버는 서명된 상대경로를 주므로 절대 URL로 바꾼다.
  const imageMap = issue.imageMap
    ? Object.fromEntries(
        Object.entries(issue.imageMap).map(([orig, rel]) => [orig, uploadUrl(rel)]),
      )
    : null;
  const hasAttachments = issue.images.length > 0 || issue.files.length > 0;
  return (
    <UserBubble
      muted
      extra={
        hasAttachments ? (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
            {issue.images.map((rel) => (
              <a key={rel} href={uploadUrl(rel)} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={uploadUrl(rel)}
                  alt=""
                  className="size-20 rounded-lg border border-border object-cover"
                />
              </a>
            ))}
            {issue.files.map((f) => (
              <a
                key={f.url}
                href={uploadUrl(f.url)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 self-end rounded-lg border border-border bg-card px-2 py-1 text-xs hover:border-accent"
              >
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-48 truncate">{f.name}</span>
              </a>
            ))}
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2">
        <div className="font-semibold">{issue.title}</div>
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {issue.labels.map((l) => (
              <Badge key={l} variant="muted">
                {l}
              </Badge>
            ))}
          </div>
        )}
        {issue.body && (
          <Markdown
            className="markdown-body"
            imageMap={imageMap}
          >
            {issue.body}
          </Markdown>
        )}
        {issue.prompt && (
          <div className="border-t border-border pt-2">
            <span className="text-xs font-medium text-muted-foreground">추가 지시</span>
            <p className="whitespace-pre-wrap">{issue.prompt}</p>
          </div>
        )}
      </div>
    </UserBubble>
  );
}

/** 진행 로그(시간순, 최근 50건) → 진행 단계. 이슈 로그에는 도구 결과가 없다. */
function logToSteps(log: IssueProgressEvent[]): ProgressStep[] {
  return log.flatMap((ev): ProgressStep[] =>
    ev.t === "tool"
      ? [{ kind: "tool", name: ev.name ?? "tool", input: ev.input ?? ev.detail }]
      : ev.detail?.trim()
        ? [{ kind: "text", text: ev.detail }]
        : [],
  );
}

/** 실행 중 진행 표시. 도구 결과가 없으므로 마지막 도구만 진행 중으로 본다. */
export function RunProgress({ log }: { log: IssueProgressEvent[] }) {
  const startedAt = log[0] ? Date.parse(log[0].at) : undefined;
  return (
    <AssistantBlock>
      <AiProgress
        steps={logToSteps(log)}
        live
        startedAt={startedAt}
        tracksResults={false}
      />
    </AssistantBlock>
  );
}

/**
 * 목록용 실행 중 한 줄: 스피너 + "명령 실행 중". 대상(명령어 등)은 다이얼로그에서 본다.
 * 아직 진행 로그가 없으면 배지('실행 중')로 충분하므로 그리지 않는다.
 */
export function RunStatusLine({ log }: { log: IssueProgressEvent[] }) {
  const steps = logToSteps(log);
  if (steps.length === 0) return null;
  return (
    <span className="flex max-w-[16rem] min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
      <span className="shimmer-text truncate">{liveStatus(steps, false)}</span>
    </span>
  );
}


/** 끝난 실행의 답변: 오류·중단 사유 + 최종 답변 + 복사. */
export function RunAnswer({ issue }: { issue: IssueTask }) {
  // 끝의 <<<RESULT … >>> 블록은 서버 파싱용(PR_URL·TRIAGE 등)이라 화면에선 뺀다.
  const answer = (issue.result ?? "").replace(/<<<RESULT[\s\S]*?(>>>|$)/, "").trim();
  if (!answer && !issue.error) return null;
  return (
    <AssistantBlock>
      {issue.error && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            issue.status === "error" ? "border-destructive/40" : "border-border",
          )}
        >
          <CircleAlert
            className={cn(
              "mt-0.5 size-4 shrink-0",
              issue.status === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          />
          <div className="min-w-0">
            <p className="font-medium">
              {issue.status === "interrupted" ? "중단 사유" : "오류"}
            </p>
            <p className="whitespace-pre-wrap text-muted-foreground">{issue.error}</p>
          </div>
        </div>
      )}
      {answer && (
        <>
          <Markdown className="markdown-body">
            {answer}
          </Markdown>
          <AnswerActions text={answer} />
        </>
      )}
    </AssistantBlock>
  );
}

/**
 * 인터뷰 카드(분석 후 진행): 에이전트 분석 요약 + 질문을 한 번에 하나씩 단계형으로 묻는다.
 * 선택지를 누르면 다음 질문으로 넘어가고, 직접 입력도 할 수 있다. 마지막에 답을 모아
 * 보여주고 제출한다. '그만 묻고 기획안 만들기'는 지금까지의 답으로 기획안을 쓰게 한다.
 * 라운드가 바뀌면(새 질문) 호출측이 key를 바꿔 상태를 새로 시작한다.
 */
export function InterviewCard({
  issueId,
  interview,
  onSubmitted,
}: {
  issueId: string;
  interview: IssueInterview;
  onSubmitted: () => void;
}) {
  const { questions } = interview;
  // step === questions.length 이면 답 확인 단계
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // 고른 선택지 키(강조용). 직접 입력이면 비운다.
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const reviewing = step >= questions.length;
  const q = questions[step];
  const answeredAll = questions.every((x) => answers[x.id]?.trim());

  function choose(key: string, text: string) {
    setAnswers((a) => ({ ...a, [q.id]: text }));
    setPicked((p) => ({ ...p, [q.id]: key }));
    setStep((s) => s + 1);
  }

  async function submit(stop: boolean) {
    setBusy(true);
    try {
      await api.post(`/issues/${issueId}/interview`, {
        answers: questions
          .filter((x) => answers[x.id]?.trim())
          .map((x) => ({ questionId: x.id, answer: answers[x.id].trim() })),
        stop,
      });
      toast.success(
        stop
          ? "지금까지의 답으로 기획안을 만듭니다."
          : "답을 보냈습니다. 에이전트가 이어서 분석합니다.",
      );
      onSubmitted();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--accent)]/40 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <MessagesSquare className="size-4 text-[var(--accent)]" />
        진행 방향을 정하기 위한 질문
        <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">
          {reviewing ? "답 확인" : `질문 ${step + 1} / ${questions.length}`}
        </span>
      </div>
      {interview.analysis && step === 0 && (
        <p className="text-sm text-muted-foreground">{interview.analysis}</p>
      )}
      {/* 진행 점 — 누르면 그 질문으로 돌아간다 */}
      <div className="flex gap-1.5">
        {questions.map((x, i) => (
          <button
            key={x.id}
            type="button"
            aria-label={`질문 ${i + 1}로 이동`}
            onClick={() => setStep(i)}
            className={cn(
              "h-1.5 flex-1 cursor-pointer rounded-full transition-colors",
              i === step
                ? "bg-[var(--accent)]"
                : answers[x.id]
                  ? "bg-[var(--accent)]/40"
                  : "bg-muted",
            )}
          />
        ))}
      </div>

      {!reviewing && q && (
        <div className="flex flex-col gap-2">
          <div className="text-base font-medium leading-snug">{q.question}</div>
          {q.reason && <p className="text-sm text-muted-foreground">{q.reason}</p>}
          {q.options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() =>
                choose(o.key, `${o.key}) ${o.label}${o.detail ? ` — ${o.detail}` : ""}`)
              }
              className={cn(
                "w-full cursor-pointer rounded-md border p-3 text-left text-sm transition-colors",
                picked[q.id] === o.key
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-border bg-background hover:bg-muted",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {o.key}) {o.label}
                </span>
                {q.recommended === o.key && <Badge variant="success">추천</Badge>}
              </div>
              {o.detail && <div className="mt-1 text-xs text-muted-foreground">{o.detail}</div>}
            </button>
          ))}
          <Textarea
            value={picked[q.id] ? "" : (answers[q.id] ?? "")}
            onChange={(e) => {
              setAnswers((a) => ({ ...a, [q.id]: e.target.value }));
              setPicked((p) => ({ ...p, [q.id]: null }));
            }}
            placeholder={
              q.options.length > 0
                ? "직접 입력 (선택지와 다르게 하고 싶을 때)"
                : "답을 입력하세요"
            }
            rows={2}
            className="resize-none text-sm"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              <ChevronLeft />
              이전
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="ml-auto"
              onClick={() => setStep((s) => s + 1)}
              disabled={!answers[q.id]?.trim()}
            >
              다음
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      {reviewing && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2 text-sm">
            {questions.map((x, i) => (
              <li key={x.id} className="rounded-md border border-border p-2">
                <button
                  type="button"
                  className="w-full cursor-pointer text-left"
                  onClick={() => setStep(i)}
                  title="이 질문으로 돌아가 고치기"
                >
                  <div className="text-muted-foreground">{x.question}</div>
                  <div className={cn("mt-0.5", !answers[x.id] && "text-destructive")}>
                    {answers[x.id]?.trim() || "아직 답하지 않았습니다"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep(questions.length - 1)}>
              <ChevronLeft />
              이전
            </Button>
            <Button
              size="sm"
              className="ml-auto rounded-full"
              onClick={() => void submit(false)}
              disabled={busy || !answeredAll}
            >
              {busy && <Loader2 className="animate-spin" />}
              답 제출
            </Button>
          </div>
        </div>
      )}

      {/* 언제든 인터뷰를 끝낼 수 있다 — 남은 쟁점은 에이전트가 가정하고 기획안에 적는다 */}
      <div className="border-t border-[var(--accent)]/20 pt-2">
        <button
          type="button"
          className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:cursor-not-allowed"
          onClick={() => void submit(true)}
          disabled={busy}
        >
          그만 묻고 기획안 만들기
        </button>
      </div>
    </section>
  );
}

/**
 * 기획안 카드(분석 후 진행의 검토 단계). 승인·수정 요청은 아래 입력창에서 한다.
 * GitHub에서 온 이슈면 기획안을 이슈 코멘트로 남길 수 있다(버튼으로 선택 게시).
 */
export function PlanCard({
  issue,
  onChanged,
}: {
  issue: IssueTask;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function postToGithub() {
    setBusy(true);
    try {
      await api.post(`/issues/${issue.id}/plan-comment`);
      toast.success("GitHub 이슈에 기획안을 남겼습니다.");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--accent)]/40 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ClipboardList className="size-4 text-[var(--accent)]" />
        기획안
      </div>
      <Markdown className="markdown-body">{issue.plan ?? ""}</Markdown>
      {issue.issueNumber ? (
        <div className="border-t border-[var(--accent)]/20 pt-3">
          {issue.planCommentUrl ? (
            <div className="text-xs text-muted-foreground">
              이 기획안을 GitHub 이슈에 남겼습니다 —{" "}
              <a href={issue.planCommentUrl} target="_blank" rel="noreferrer" className="underline">
                코멘트 보기
              </a>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={postToGithub} disabled={busy}>
              GitHub 이슈에 남기기
            </Button>
          )}
        </div>
      ) : null}
      <p className="border-t border-[var(--accent)]/20 pt-2 text-xs text-muted-foreground">
        고칠 점이 있으면 아래 입력창에 적어 <b>수정 요청</b>하세요. 괜찮으면{" "}
        <b>이 방향으로 처리 시작</b>을 누르면 기획안대로 작업합니다.
      </p>
    </section>
  );
}

/** 승인된 기획안(작업 중·완료 후 대화에서 접어 둔다). */
export function ApprovedPlan({ plan }: { plan: string }) {
  return (
    <details className="rounded-lg border border-border">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
        <ClipboardList className="size-4" />
        승인된 기획안
      </summary>
      <div className="border-t border-border p-3">
        <Markdown className="markdown-body">{plan}</Markdown>
      </div>
    </details>
  );
}
