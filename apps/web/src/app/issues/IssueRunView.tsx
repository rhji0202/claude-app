"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  Loader2,
  Maximize2,
  MessageSquare,
  Play,
  Plus,
  RotateCcw,
  Square,
} from "lucide-react";
import type { IssueNote, IssueTask } from "@claude-app/shared";
import { api, streamGet, upload, uploadUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/Markdown";
import { Mono, StatusBadge } from "@/components/StatusBadge";
import { AssistantBlock, UserBubble } from "@/components/ChatUi";
import {
  ApprovedPlan,
  DecisionCard,
  InterviewCard,
  IssueBubble,
  PlanCard,
  RunAnswer,
  RunProgress,
  issueStateLabel,
} from "./issue-parts";

/**
 * 이슈 실행 화면(대화형): 이슈 본문이 첫 사용자 말풍선이고, 사람 지시·에이전트 메모가
 * 시간순 대화로 이어지며, 이번 실행이 마지막 답변(진행 표시 + 최종 답변)으로 붙는다.
 * 하단 입력창에서 다음 실행에 반영할 지시를 남기고 실행·재개·중지한다.
 * 실행 중에는 /issues/stream SSE로 이 이슈의 변화만 받아 조용히 갱신한다.
 *
 * 결정 대기는 답에 집중하도록 실행 결과·이력을 감추고 에이전트 질문만 보여준다.
 * 분석 후 진행이면 같은 자리에 인터뷰 카드(단계형 질문)나 기획안 카드가 오고,
 * 입력창은 인터뷰 중엔 숨기고 기획 검토 중엔 수정 요청·승인 입력이 된다.
 *
 * 전용 페이지(/issues/[id])와 목록의 다이얼로그가 함께 쓴다. inDialog면 헤더의
 * '목록으로' 대신 '전체 화면' 링크를 두고, 닫기(X) 자리를 비워 둔다.
 */
export function IssueRunView({ id, inDialog = false }: { id: string; inDialog?: boolean }) {
  const [issue, setIssue] = useState<IssueTask | null>(null);
  const [notes, setNotes] = useState<IssueNote[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [next, nextNotes] = await Promise.all([
        api.get<IssueTask>(`/issues/${id}`),
        api.get<IssueNote[]>(`/issues/${id}/notes`),
      ]);
      setIssue(next);
      setNotes(nextNotes);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // 이 이슈의 진행·상태 이벤트만 골라 갱신한다. 진행 이벤트가 잦아 500ms로 묶는다.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const ctrl = new AbortController();
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let retry = 0;
    const onEvent = (e: unknown) => {
      if ((e as { issueId?: string }).issueId !== id || debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        void loadRef.current();
      }, 500);
    };
    const connect = () => {
      streamGet("/issues/stream", onEvent, ctrl.signal)
        .then(() => {
          if (!ctrl.signal.aborted) reconnect = setTimeout(connect, 1000);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          retry = Math.min(retry + 1, 5);
          reconnect = setTimeout(connect, 1000 * 2 ** (retry - 1));
        });
    };
    connect();
    return () => {
      ctrl.abort();
      if (debounce) clearTimeout(debounce);
      if (reconnect) clearTimeout(reconnect);
    };
  }, [id]);

  // 대화가 늘면(진행·메모) 맨 아래로.
  const logLength = issue?.progressLog?.length ?? 0;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [issue?.status, logLength, notes?.length]);

  if (loadError && !issue) {
    return (
      <div className="flex h-full flex-col">
        <RunHeader issue={null} inDialog={inDialog} />
        <p className="p-6 text-sm text-destructive">{loadError}</p>
      </div>
    );
  }
  if (!issue) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const status = issue.status;
  const isDecision = status === "needs_decision";
  const isRunning = status === "running";
  const isQueued = status === "queued";
  // 분석 후 진행의 사람 차례: 인터뷰 답변 / 기획안 검토. 그 밖의 결정 대기는 기존 질문 카드.
  const interviewing = isDecision && issue.planStage === "interview";
  const reviewing = isDecision && issue.planStage === "review";
  const legacyDecision = isDecision && !interviewing && !reviewing;
  const finished = status === "done" || status === "error" || status === "interrupted";
  // 에이전트의 마지막 질문(가장 최근 AGENT 메모) — 결정 대기에서만 쓴다.
  const question = notes
    ? [...notes].reverse().find((n) => n.author === "agent")?.content
    : null;

  /**
   * + 버튼·붙여넣기로 올린 파일. 이미지는 지시 본문에 마크다운으로 넣고(다음 실행에
   * 첨부 이미지로 실린다), 그 외 파일은 이슈 첨부로 올린다(작업 디렉터리로 복사됨).
   */
  async function uploadFiles(picked: File[]) {
    if (picked.length === 0) return;
    setUploading(true);
    try {
      const images = picked.filter((f) => f.type.startsWith("image/"));
      const others = picked.filter((f) => !f.type.startsWith("image/"));
      for (const file of images) {
        const form = new FormData();
        form.append("files", file);
        const res = await upload<{ images: string[] }>(`/issues/${id}/images`, form);
        const url = uploadUrl(res.images[res.images.length - 1]);
        setMemo((m) => `${m}${m && !m.endsWith("\n") ? "\n" : ""}![${file.name}](${url})\n`);
      }
      if (others.length > 0) {
        const form = new FormData();
        for (const f of others) form.append("files", f);
        await upload(`/issues/${id}/files`, form);
        toast.success(`파일 ${others.length}개를 첨부했습니다.`);
      }
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  /** 입력한 지시를 메모로 남긴다(다음 실행 프롬프트에 주입됨). 비어 있으면 아무것도 안 한다. */
  async function saveMemo() {
    if (!memo.trim()) return;
    await api.post(`/issues/${id}/notes`, { content: memo.trim() });
    setMemo("");
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const addMemo = () =>
    act(async () => {
      await saveMemo();
      toast.success("지시를 저장했습니다.");
    });

  // 결정 대기는 resume, 그 외 상태는 run으로 재큐.
  const rerun = () =>
    act(async () => {
      await saveMemo();
      await api.post(`/issues/${id}/${isDecision ? "resume" : "run"}`);
      toast.success("대기열에 넣었습니다. 워커가 처리합니다.");
    });

  const cancel = () =>
    act(async () => {
      await api.post(`/issues/${id}/cancel`);
      toast.success("중지 신호를 보냈습니다.");
    });

  // 기획 검토: 입력창 내용으로 수정 요청 / 이대로 승인.
  const revisePlan = () =>
    act(async () => {
      await api.post(`/issues/${id}/plan/revise`, { request: memo.trim() });
      setMemo("");
      toast.success("수정 요청을 보냈습니다. 에이전트가 기획안을 다시 씁니다.");
    });

  const approvePlan = () =>
    act(async () => {
      await api.post(`/issues/${id}/plan/approve`);
      toast.success("기획안대로 처리를 시작합니다.");
    });

  // 분석부터 다시: 입력한 지시는 메모로 남겨 분석에 반영한다.
  const replan = () =>
    act(async () => {
      await saveMemo();
      await api.post(`/issues/${id}/replan`);
      toast.success("분석부터 다시 시작합니다.");
    });

  /**
   * 이슈의 실행 세션을 이어받는 대화를 만들고 채팅 화면으로 이동한다.
   * 이슈 상태는 바꾸지 않는다 — 대화에서 결론이 나도 이슈 완료는 사람이 정한다.
   * 전용 worktree에서 연다(이슈 작업 브랜치 기준, clone base는 건드리지 않음).
   */
  async function continueInChat() {
    setBusy(true);
    try {
      await saveMemo();
      const s = await api.post<{ id: string }>("/chat/sessions", {
        fromIssueId: id,
        useWorktree: true,
      });
      window.location.href = `/chat?session=${s.id}`;
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  const runLabel = isQueued
    ? "대기 중"
    : isDecision
      ? memo.trim()
        ? "답 반영해 재개"
        : "재개"
      : memo.trim()
        ? "지시 반영해 재실행"
        : status === "done" || status === "error" || status === "interrupted"
          ? "재실행"
          : "실행";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <RunHeader issue={issue} inDialog={inDialog} />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
          <IssueBubble issue={issue} />

          {/* 이력 대화 — 결정 대기에서는 질문에 집중하도록 감춘다 */}
          {!isDecision && notes?.map((n) => <NoteMessage key={n.id} note={n} />)}

          {isQueued && (
            <AssistantBlock>
              <p className="flex min-h-7 items-center gap-2 text-sm text-muted-foreground">
                <Clock className="size-4" />
                대기열에 있습니다. 워커가 순서대로 처리합니다.
              </p>
            </AssistantBlock>
          )}

          {/* 기획안대로 작업 중·작업 후에는 승인된 기획안을 접어 둔다 */}
          {!isDecision && issue.planStage === "approved" && issue.plan && (
            <AssistantBlock>
              <ApprovedPlan plan={issue.plan} />
            </AssistantBlock>
          )}

          {isRunning && <RunProgress log={issue.progressLog ?? []} />}

          {interviewing && issue.interview && (
            <AssistantBlock>
              <InterviewCard
                // 새 라운드(새 질문)면 단계·답 상태를 새로 시작한다
                key={issue.interview.questions.map((q) => q.id + q.question).join("|")}
                issueId={id}
                interview={issue.interview}
                onSubmitted={() => void load()}
              />
            </AssistantBlock>
          )}

          {reviewing && (
            <AssistantBlock>
              <PlanCard issue={issue} onChanged={() => void load()} />
            </AssistantBlock>
          )}

          {legacyDecision && question && (
            <AssistantBlock>
              <DecisionCard
                issueId={id}
                question={question}
                canAskGithub={Boolean(issue.issueNumber)}
                initialAskedUrl={issue.decisionCommentUrl ?? null}
                onPick={setMemo}
                onChanged={() => void load()}
              />
            </AssistantBlock>
          )}

          {!isDecision && !isRunning && !isQueued && <RunAnswer issue={issue} />}
        </div>
      </div>

      {/* 입력 — 다음 실행에 반영할 지시 + 실행/재개/중지. 인터뷰 중엔 카드가 입력을 맡는다. */}
      {!interviewing && (
      <div className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
          <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-3 pt-3 pb-2 shadow-sm transition-colors">
            <Textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              onPaste={(e) => {
                // 스크린샷 붙여넣기 — 클립보드에 파일이 있을 때만 가로챈다.
                const files = Array.from(e.clipboardData.files);
                if (files.length === 0) return;
                e.preventDefault();
                void uploadFiles(files);
              }}
              placeholder={
                reviewing
                  ? "기획안에서 고칠 점을 적으면 에이전트가 기획안을 다시 씁니다."
                  : isDecision
                    ? "위에서 선택지를 고르거나 답을 직접 적으세요."
                    : "다음 실행에 반영할 지시를 입력하세요. (선택)"
              }
              aria-label="지시 입력"
              className="max-h-48 min-h-11 resize-none border-0 bg-transparent px-1 py-1 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 lg:text-[0.95rem]"
              rows={2}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void uploadFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="size-9 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
                aria-label="파일 또는 사진 추가"
                title="파일 또는 사진 추가 (이미지는 지시에 들어가고, 그 외 파일은 이슈 첨부로 올라갑니다)"
              >
                {uploading ? <Loader2 className="animate-spin" /> : <Plus className="size-5" />}
              </Button>
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {!reviewing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addMemo}
                    disabled={busy || !memo.trim()}
                  >
                    지시만 저장
                  </Button>
                )}
                {/* 끝났거나 결정 대기인 이슈는 분석·인터뷰로 방향부터 다시 잡을 수 있다(바로 처리였어도) */}
                {(finished || legacyDecision) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={replan}
                    disabled={busy}
                    title="이슈를 다시 분석해 질문하고, 답으로 정한 기획안을 승인하면 작업합니다. 입력한 지시도 분석에 반영됩니다."
                  >
                    <RotateCcw />
                    분석부터 다시
                  </Button>
                )}
                {/* 실행된 적 없으면(sessionId 없음) 이어받을 맥락이 없어 감춘다. */}
                {issue.sessionId && !isRunning && !isQueued ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={continueInChat}
                    disabled={busy}
                    title="이슈의 대화 맥락과 작업 브랜치를 이어받아 전용 작업 공간에서 채팅을 시작합니다. 이슈 브랜치는 그대로 두므로 이슈 재실행에 영향이 없습니다."
                  >
                    <MessageSquare />
                    대화로 이어가기
                  </Button>
                ) : null}
                {isRunning ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="rounded-full"
                    onClick={cancel}
                    disabled={busy}
                  >
                    <Square className="size-3.5 fill-current" />
                    중지
                  </Button>
                ) : reviewing ? (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={revisePlan}
                      disabled={busy || !memo.trim()}
                    >
                      수정 요청
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-full"
                      onClick={approvePlan}
                      disabled={busy || Boolean(memo.trim())}
                      title={memo.trim() ? "입력한 수정 요청을 먼저 보내거나 지우세요." : undefined}
                    >
                      {busy ? <Loader2 className="animate-spin" /> : <Play />}
                      이 방향으로 처리 시작
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    className="rounded-full"
                    onClick={rerun}
                    disabled={busy || isQueued}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <Play />}
                    {runLabel}
                  </Button>
                )}
              </div>
            </div>
          </div>
          {legacyDecision && (
            <p className="hidden text-center text-xs text-muted-foreground lg:block">
              선택지를 누르면 입력창에 채워집니다 · 재개는 직접 누르세요
            </p>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

/** 상단 헤더: 목록으로(페이지) · #번호 제목 · 상태 · 링크 · 전체 화면(다이얼로그). */
function RunHeader({ issue, inDialog }: { issue: IssueTask | null; inDialog: boolean }) {
  return (
    <header
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 border-b border-border px-3 py-2 sm:px-4",
        // 다이얼로그 닫기(X) 버튼 자리
        inDialog && "pr-12 sm:pr-12",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {!inDialog && (
          <Button asChild variant="ghost" size="icon" aria-label="이슈 목록으로">
            <Link href="/issues">
              <ArrowLeft />
            </Link>
          </Button>
        )}
        {issue && (
          <>
            {issue.issueNumber ? <Mono>#{issue.issueNumber}</Mono> : null}
            <span className="min-w-0 truncate text-sm font-semibold" title={issue.title}>
              {issue.title}
            </span>
            <StatusBadge status={issue.status} label={issueStateLabel(issue)} />
          </>
        )}
      </div>
      {issue && (
        <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          {issue.prUrl && (
            <a
              href={issue.prUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline underline-offset-2"
            >
              PR
            </a>
          )}
          {issue.url && (
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          )}
          {inDialog && (
            <Link
              href={`/issues/${issue.id}`}
              className="inline-flex items-center gap-1 hover:text-foreground"
              title="전체 화면으로 열기"
            >
              <Maximize2 className="size-3.5" />
              <span className="hidden sm:inline">전체 화면</span>
            </Link>
          )}
        </div>
      )}
    </header>
  );
}

/**
 * 이력 메모 한 건: 사람 = 사용자 말풍선, 에이전트 = 답변.
 * 시스템 메모("사람이 재개했습니다." 등)는 대화 흐름에 군더더기라 보여주지 않는다.
 */
function NoteMessage({ note }: { note: IssueNote }) {
  if (note.author === "system") return null;
  // 메모는 줄 단위로 쓴 글(질문·선택지·답)이라 줄바꿈을 그대로 살린다
  // (마크다운은 한 줄 개행을 공백으로 합쳐 한 문단으로 뭉갠다).
  const body = (
    <Markdown className="markdown-body">
      {note.content.replace(/\n(?!\n)/g, "  \n")}
    </Markdown>
  );
  return note.author === "human" ? (
    <UserBubble muted>{body}</UserBubble>
  ) : (
    <AssistantBlock>{body}</AssistantBlock>
  );
}


/**
 * 목록에서 여는 실행 다이얼로그. 화면 본체는 전용 페이지와 같은 IssueRunView라
 * 진행·결정·답변·지시·재실행·중지를 페이지 이동 없이 다룬다. id가 null이면 닫힘.
 */
export function IssueRunDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[88dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">이슈 실행</DialogTitle>
        {id && <IssueRunView id={id} inDialog />}
      </DialogContent>
    </Dialog>
  );
}
