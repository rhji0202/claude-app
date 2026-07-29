"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, GitBranch, PanelLeft, Square } from "lucide-react";
import { toast } from "sonner";
import {
  AssistantLine,
  ThinkingLine,
  ToolLine,
  UserLine,
  formatTokens,
} from "@/components/TerminalTranscript";
import { api, streamPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SessionList,
  type ChatSession,
  type Project,
} from "./SessionList";
/** 순서 있는 파트(CLI 트랜스크립트). text는 id로 delta/end를 매칭. */
type Part =
  | { type: "text"; id: string; text: string; streaming?: boolean }
  | {
      type: "tool";
      id: string;
      name: string;
      input?: string;
      result?: string;
      resultIsError?: boolean;
      /** 실행 경과 초. 진행 중에만 갱신되며 저장되지 않는다(재로드 시 없음). */
      elapsedSeconds?: number;
      /** 서브에이전트(Task) 진행. 진행 표시 전용이며 저장되지 않는다. */
      agent?: {
        description: string;
        agentType?: string;
        tokens?: number;
        toolUses?: number;
        lastToolName?: string;
        summary?: string;
      };
      /**
       * 서브에이전트가 만든 하위 파트(중첩 트랜스크립트).
       * 실행 중 화면에만 존재하고 저장되지 않는다 — 재로드 시 없다.
       */
      children?: Part[];
    };
interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  parts?: Part[];
}
type StreamEvent =
  | { type: "session"; sessionId: string }
  // parentId가 있으면 그 id의 Task 파트 안쪽(children)에 렌더한다.
  | { type: "text_start"; id: string; parentId?: string }
  | { type: "text_delta"; id: string; delta: string; parentId?: string }
  | { type: "text_end"; id: string; text: string; parentId?: string }
  | {
      type: "tool";
      id: string;
      name: string;
      input?: string;
      parentId?: string;
    }
  | {
      type: "tool_result";
      id: string;
      content: string;
      isError?: boolean;
      parentId?: string;
    }
  | { type: "tool_progress"; id: string; elapsedSeconds: number }
  | { type: "thinking_tokens"; tokens: number }
  | {
      type: "api_retry";
      attempt: number;
      maxRetries: number;
      delayMs: number;
      reason: string;
    }
  | {
      type: "rate_limit";
      status: "allowed_warning" | "rejected";
      utilization?: number;
      resetsAt?: string;
      limitType?: string;
    }
  | {
      type: "agent_start";
      id: string;
      taskId: string;
      description: string;
      agentType?: string;
    }
  | {
      type: "agent_progress";
      id: string;
      taskId: string;
      tokens: number;
      toolUses: number;
      lastToolName?: string;
      summary?: string;
    }
  | { type: "done"; text: string }
  | { type: "error"; error: string };

/** SDK 재시도 사유 코드 → 한국어 문구. 미매핑 코드는 그대로 노출한다. */
const RETRY_REASON: Record<string, string> = {
  rate_limit: "사용량 한도",
  overloaded: "서버 혼잡",
  server_error: "서버 오류",
  billing_error: "결제 오류",
  authentication_failed: "인증 실패",
  invalid_request: "잘못된 요청",
  model_not_found: "모델 없음",
  max_output_tokens: "출력 한도 초과",
};

/**
 * 이벤트 → parts 리듀서. id로 파트를 식별해 delta는 누적, text_end는 확정(교체).
 * → delta와 완결 블록이 같은 파트에 수렴하므로 중복이 원천 차단됨.
 *
 * parentId가 있는 이벤트(서브에이전트)는 해당 Task 파트의 children으로 재귀 위임한다.
 * → 중첩 깊이에 무관하게 같은 규칙이 적용된다.
 */
function reduceParts(parts: Part[], e: StreamEvent): Part[] {
  // 서브에이전트 소속이면 부모 파트 안쪽으로 내려보낸다.
  if ("parentId" in e && e.parentId) {
    const parentId = e.parentId;
    // 부모 Task 파트가 아직 없으면 만들어 둔다(이벤트 순서 역전 대비).
    const exists = parts.some((p) => p.type === "tool" && p.id === parentId);
    const base: Part[] = exists
      ? parts
      : [...parts, { type: "tool", id: parentId, name: "Task" }];
    // parentId를 벗겨서 위임 — 자식 레벨에서는 자기 id로만 판단해야 한다.
    const { parentId: _drop, ...inner } = e;
    return base.map((p) =>
      p.type === "tool" && p.id === parentId
        ? { ...p, children: reduceParts(p.children ?? [], inner as StreamEvent) }
        : p,
    );
  }
  switch (e.type) {
    case "text_start":
      if (parts.some((p) => p.type === "text" && p.id === e.id)) return parts;
      return [...parts, { type: "text", id: e.id, text: "", streaming: true }];
    case "text_delta":
      return parts.map((p) =>
        p.type === "text" && p.id === e.id
          ? { ...p, text: p.text + e.delta }
          : p,
      );
    case "text_end":
      return parts.map((p) =>
        p.type === "text" && p.id === e.id
          ? { ...p, text: e.text, streaming: false }
          : p,
      );
    case "tool":
      if (parts.some((p) => p.type === "tool" && p.id === e.id)) return parts;
      return [...parts, { type: "tool", id: e.id, name: e.name, input: e.input }];
    case "tool_result":
      return parts.map((p) =>
        p.type === "tool" && p.id === e.id
          ? { ...p, result: e.content, resultIsError: e.isError }
          : p,
      );
    case "tool_progress":
      // 갱신(누적 아님). 대응 파트가 아직 없으면 무시 — tool 이벤트가 곧 만든다.
      return parts.map((p) =>
        p.type === "tool" && p.id === e.id
          ? { ...p, elapsedSeconds: e.elapsedSeconds }
          : p,
      );
    case "agent_start": {
      // task_started가 tool 이벤트보다 먼저 올 수 있어, 없으면 파트를 만들어 둔다.
      const agent = { description: e.description, agentType: e.agentType };
      if (!parts.some((p) => p.type === "tool" && p.id === e.id)) {
        return [...parts, { type: "tool", id: e.id, name: "Task", agent }];
      }
      return parts.map((p) =>
        p.type === "tool" && p.id === e.id ? { ...p, agent } : p,
      );
    }
    case "agent_progress":
      return parts.map((p) =>
        p.type === "tool" && p.id === e.id
          ? {
              ...p,
              agent: {
                // agent_start를 놓쳤어도 진행은 보여준다.
                description: p.agent?.description ?? "",
                agentType: p.agent?.agentType,
                tokens: e.tokens,
                toolUses: e.toolUses,
                lastToolName: e.lastToolName,
                summary: e.summary,
              },
            }
          : p,
      );
    default:
      return parts;
  }
}

/**
 * 좁은 화면(<lg) 여부. Enter 키 동작을 나누는 데 쓴다 — 모바일 키보드는
 * ⇧⏎를 낼 수 없으므로 Enter는 줄바꿈이어야 하고, 전송은 버튼으로만 한다.
 * 초기값 false → 서버 렌더와 첫 페인트가 일치한다(hydration 불일치 방지).
 */
function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    setNarrow(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** assistant 메시지의 parts를 CLI 트랜스크립트 줄로 펼친다. */
function AssistantParts({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((p) => {
        if (p.type === "tool") {
          return (
            <ToolLine
              key={p.id}
              name={p.name}
              input={p.input}
              result={p.result}
              resultIsError={p.resultIsError}
              elapsedSeconds={p.elapsedSeconds}
              agent={p.agent}
            >
              {/* 서브에이전트가 만든 하위 트랜스크립트(재귀) */}
              {p.children && p.children.length > 0 && (
                <AssistantParts parts={p.children} />
              )}
            </ToolLine>
          );
        }
        if (!p.text) return p.streaming ? <ThinkingLine key={p.id} /> : null;
        return <AssistantLine key={p.id} text={p.text} />;
      })}
    </>
  );
}

export default function ChatPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [input, setInput] = useState("");
  /**
   * 실행 중인 세션 id(없으면 null). 불리언이 아니라 id로 들고 있어야
   * 다른 세션으로 옮겼을 때 그 세션이 함께 잠기지 않는다.
   */
  const [runningSessionId, setRunningSessionId] = useState<string | null>(null);
  const [newProjectId, setNewProjectId] = useState("");
  /** 관리 clone이 체크아웃한 브랜치. clone 전이면 null → 배너에서 생략. */
  const [branch, setBranch] = useState<string | null>(null);
  /** 이번 실행의 사고 토큰 누적 추정치(상태줄). 전송 시마다 초기화. */
  const [thinkingTokens, setThinkingTokens] = useState(0);
  /** 실행 중 스트림 취소용. esc로 abort하면 서버가 interrupt()를 호출한다. */
  const abortRef = useRef<AbortController | null>(null);
  /** 진행 중인 재시도 알림. 다음 이벤트가 오면 사라진다(성공했다는 뜻). */
  const [retrying, setRetrying] = useState<{
    attempt: number;
    maxRetries: number;
    reason: string;
  } | null>(null);
  /**
   * ↑/↓ 입력 히스토리 커서. -1 = 편집 중(히스토리 밖).
   * 히스토리 소스는 messages의 user 항목이라 세션 전환·재로드 후에도 유지된다.
   */
  const [histIndex, setHistIndex] = useState(-1);
  /** 히스토리 탐색을 시작할 때의 입력값. ↓로 끝까지 내려오면 복원한다. */
  const histDraftRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * 스트림 콜백이 읽는 "지금 열린 세션". 콜백은 send() 호출 시점의 activeId를
   * 클로저로 붙잡으므로, 최신 값을 보려면 ref가 필요하다.
   */
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  /** 이번 실행에서 화면에 반영하지 못한 이벤트가 있었는지. 끝난 뒤 재조회 판단에 쓴다. */
  const missedRef = useRef(false);
  /**
   * 실행 중 세션의 진행분(assistant parts) 사본.
   *
   * elapsedSeconds·children·agent 진행은 DB에 저장하지 않으므로 세션을 옮겼다
   * 돌아오면 서버 조회로는 복원할 수 없다. 다른 세션을 보는 동안에도 이 ref에
   * 계속 누적해 두고, 돌아왔을 때 화면에 되돌린다.
   */
  const liveParts = useRef<{ sessionId: string; parts: Part[] } | null>(null);
  /** runningSessionId의 ref 사본 — deps가 빈 openSession에서 읽어야 한다. */
  const runningSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    runningSessionIdRef.current = runningSessionId;
  }, [runningSessionId]);
  /** 모바일 세션 목록 드로어(<lg 전용). */
  const [listOpen, setListOpen] = useState(false);
  /** 삭제 확인 대기 중인 세션. null이면 확인 팝업을 닫는다. */
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null);
  const isNarrow = useIsNarrow();

  const activeSession = sessions.find((s) => s.id === activeId);
  const activeProject = projects.find((p) => p.id === activeSession?.projectId);
  /** 지금 보고 있는 세션이 실행 중인가. 다른 세션 실행은 이 화면을 잠그지 않는다. */
  const streaming = runningSessionId !== null && runningSessionId === activeId;

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await api.get<ChatSession[]>("/chat/sessions"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api.get<Project[]>("/projects").then(setProjects).catch(() => setProjects([]));
    loadSessions();
  }, [loadSessions]);

  const openSession = useCallback(async (id: string) => {
    setActiveId(id);
    // ref는 즉시 맞춘다 — effect를 기다리면 아래 await 동안 실행 중인 스트림이
    // 이 세션의 이벤트로 착각해 곧 덮어쓸 트랜스크립트에 써버린다.
    activeIdRef.current = id;
    setListOpen(false); // 모바일 드로어에서 골랐으면 바로 대화로 넘어간다
    setLoadingMsgs(true);
    setBranch(null);
    setHistIndex(-1); // 히스토리는 세션별 — 전환 시 커서를 되돌린다
    try {
      const s = await api.get<{
        messages: ChatMessage[];
        branch: string | null;
      }>(`/chat/sessions/${id}`);
      const saved = s.messages ?? [];
      // 실행 중인 세션으로 돌아온 경우: 서버에는 아직 저장되지 않은 진행분이 있다.
      // ref에 누적해 둔 live parts로 복원한다(경과 시간·중첩 내역까지 그대로).
      if (id === runningSessionIdRef.current) {
        missedRef.current = true;
        const live =
          liveParts.current?.sessionId === id ? liveParts.current.parts : [];
        setMessages([...saved, { role: "assistant", content: "", parts: live }]);
      } else {
        setMessages(saved);
      }
      setBranch(s.branch ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // 입력 높이를 내용에 맞춘다(최대 높이는 CSS max-h가 잡고 그 뒤로는 스크롤).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // esc = 실행 중단(CLI와 동일). 입력창 포커스 여부와 무관하게 동작해야 하므로
  // window 레벨에서 듣는다. 실행 중이 아닐 때는 아무 일도 하지 않는다.
  useEffect(() => {
    if (!streaming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        abortRef.current?.abort();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [streaming]);

  async function newSession() {
    if (!newProjectId) return toast.error("프로젝트를 선택하세요.");
    try {
      const s = await api.post<ChatSession>("/chat/sessions", {
        projectId: newProjectId,
      });
      setSessions((prev) => [s, ...prev]);
      setActiveId(s.id);
      activeIdRef.current = s.id; // openSession과 동일한 이유로 즉시 반영
      setListOpen(false);
      setMessages([]);
      // 새 세션은 아직 실행 이력이 없어 clone도 없을 수 있다. 첫 전송 후 갱신된다.
      setBranch(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  /** 확인 후 실제 삭제. 터치에서는 삭제 버튼이 항상 노출되므로 확인을 거친다. */
  async function deleteSession(id: string) {
    setPendingDelete(null);
    try {
      await api.del(`/chat/sessions/${id}`);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function send() {
    const prompt = input.trim();
    // 실행 중인 세션이 있으면(그 세션이 무엇이든) 새 실행을 받지 않는다 —
    // 스트림 핸들(abortRef)이 하나뿐이라 동시 실행은 중단 대상을 잃는다.
    if (!prompt || !activeId || runningSessionId !== null) return;
    // 이 실행이 속한 세션을 고정한다. 도중에 activeId가 바뀌어도 이 값은 그대로다.
    const sessionId = activeId;
    setInput("");
    setThinkingTokens(0);
    setRetrying(null);
    setHistIndex(-1);
    setMessages((m) => [
      ...m,
      { role: "user", content: prompt },
      // assistant 자리 확보 (parts를 스트리밍으로 채움)
      { role: "assistant", content: "", parts: [] },
    ]);
    setRunningSessionId(sessionId);
    runningSessionIdRef.current = sessionId; // effect를 기다리지 않고 즉시 반영
    missedRef.current = false;
    liveParts.current = { sessionId, parts: [] }; // 새 실행 — 진행분 초기화
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await streamPost(
        `/chat/sessions/${sessionId}/messages`,
        { prompt },
        (raw) => {
          const e = raw as StreamEvent;
          const isPart =
            e.type === "text_start" ||
            e.type === "text_delta" ||
            e.type === "text_end" ||
            e.type === "tool" ||
            e.type === "tool_result" ||
            e.type === "tool_progress" ||
            e.type === "agent_start" ||
            e.type === "agent_progress";

          // 화면과 무관하게 진행분을 ref에 누적한다 — 다른 세션을 보다 돌아왔을 때
          // 저장되지 않는 상태(경과 시간·중첩 내역)를 되돌리는 유일한 경로다.
          if (isPart) {
            const cur =
              liveParts.current?.sessionId === sessionId
                ? liveParts.current.parts
                : [];
            liveParts.current = {
              sessionId,
              parts: reduceParts(cur, e),
            };
          }

          // 다른 세션을 보고 있는 동안 온 이벤트는 화면에 쓰지 않는다 —
          // 남의 트랜스크립트에 섞여 들어가는 것을 막는다. 실행은 계속되고,
          // 돌아오면 위 ref로 복원한다(missedRef는 완료 후 최종 동기화용).
          if (sessionId !== activeIdRef.current) {
            missedRef.current = true;
            return;
          }
          // 불변 업데이트: 마지막 assistant 메시지의 parts를 리듀서로 갱신.
          const patchLast = (fn: (m: ChatMessage) => ChatMessage) =>
            setMessages((msgs) => {
              const last = msgs[msgs.length - 1];
              if (last?.role !== "assistant") return msgs;
              return [...msgs.slice(0, -1), fn(last)];
            });

          if (
            e.type === "text_start" ||
            e.type === "text_delta" ||
            e.type === "text_end" ||
            e.type === "tool" ||
            e.type === "tool_result" ||
            e.type === "tool_progress" ||
            e.type === "agent_start" ||
            e.type === "agent_progress"
          ) {
            // 내용이 흐르기 시작했으면 재시도는 성공한 것 — 알림을 지운다.
            setRetrying(null);
            patchLast((m) => ({ ...m, parts: reduceParts(m.parts ?? [], e) }));
          } else if (e.type === "thinking_tokens") {
            // 파트가 아닌 세션 단위 값 — 상태줄에만 쓴다.
            setThinkingTokens(e.tokens);
          } else if (e.type === "api_retry") {
            // 재시도 중임을 상태줄에 노출한다(예전엔 조용히 멈춘 것처럼 보였다).
            setRetrying({
              attempt: e.attempt,
              maxRetries: e.maxRetries,
              reason: RETRY_REASON[e.reason] ?? e.reason,
            });
          } else if (e.type === "rate_limit") {
            const reset = e.resetsAt
              ? ` (${new Date(e.resetsAt).toLocaleTimeString()} 초기화)`
              : "";
            if (e.status === "rejected") {
              toast.error(`사용량 한도에 도달했습니다.${reset}`);
            } else {
              const pct =
                e.utilization !== undefined
                  ? ` ${Math.round(e.utilization * 100)}%`
                  : "";
              toast.warning(`사용량 한도에 근접했습니다${pct}.${reset}`);
            }
          } else if (e.type === "done") {
            patchLast((m) => ({ ...m, content: e.text || m.content }));
          } else if (e.type === "error") {
            toast.error(e.error);
            patchLast((m) => ({
              ...m,
              parts: [
                ...(m.parts ?? []),
                {
                  type: "text",
                  id: "error",
                  text: `⚠️ ${e.error}`,
                },
              ],
            }));
          }
        },
        ac.signal,
      );
      loadSessions();
      // 첫 실행이 clone을 만들므로 브랜치가 이제 읽힌다. 실패는 무시(표시 전용).
      // 그 세션을 계속 보고 있을 때만 배너를 갱신한다.
      if (!branch && sessionId === activeIdRef.current) {
        api
          .get<{ branch: string | null }>(`/chat/sessions/${sessionId}`)
          .then((s) => setBranch(s.branch ?? null))
          .catch(() => {});
      }
    } catch (e) {
      // esc 중단은 오류가 아니다 — 서버가 interrupt()로 부분 응답을 저장한다.
      if (ac.signal.aborted) {
        toast.info("중단했습니다.");
        loadSessions();
      } else {
        toast.error((e as Error).message);
      }
    } finally {
      abortRef.current = null;
      setRunningSessionId(null);
      runningSessionIdRef.current = null;
      setRetrying(null);
      // 실행이 끝나면 진행분은 버린다 — 이후 재방문은 저장된 내역이 정본이다.
      // (남겨두면 완료된 세션에 옛 진행 표시가 다시 붙는다)
      liveParts.current = null;
      // 실행 중 다른 세션을 보느라 놓친 이벤트가 있고, 지금 그 세션으로 돌아와
      // 있다면 서버 내역으로 맞춘다. 놓친 게 없으면 화면이 이미 정확하다.
      if (missedRef.current && sessionId === activeIdRef.current) {
        api
          .get<{ messages: ChatMessage[] }>(`/chat/sessions/${sessionId}`)
          .then((s) => setMessages(s.messages ?? []))
          .catch(() => {});
      }
    }
  }

  /** 실행 중 스트림 중단(esc). 서버가 감지해 interrupt()를 호출한다. */
  function stopStreaming() {
    abortRef.current?.abort();
  }

  /**
   * ↑/↓ 입력 히스토리. 현재 세션에서 보낸 user 메시지를 최신순으로 훑는다.
   * dir=-1이 과거(↑), +1이 최근(↓). 끝까지 내려오면 원래 입력값으로 복원한다.
   */
  function navigateHistory(dir: -1 | 1) {
    const history = messages
      .filter((m) => m.role === "user" && m.content.trim())
      .map((m) => m.content)
      .reverse();
    if (history.length === 0) return;

    // 편집 중이었다면 지금 값을 보관해 두고(↓로 돌아올 자리) 히스토리에 진입한다.
    if (histIndex === -1) {
      if (dir === 1) return; // 편집 중에 ↓는 할 일이 없다
      histDraftRef.current = input;
    }

    const next = histIndex + (dir === -1 ? 1 : -1);
    if (next < 0) {
      // 히스토리 밖으로 나옴 — 보관한 입력값 복원
      setHistIndex(-1);
      setInput(histDraftRef.current);
      return;
    }
    if (next >= history.length) return; // 가장 오래된 항목에서 더 못 올라감
    setHistIndex(next);
    setInput(history[next]);
  }

  const sessionList = (
    <SessionList
      projects={projects}
      sessions={sessions}
      activeId={activeId}
      newProjectId={newProjectId}
      onNewProjectIdChange={setNewProjectId}
      onNewSession={newSession}
      onOpenSession={openSession}
      onDeleteSession={(id) =>
        setPendingDelete(sessions.find((s) => s.id === id) ?? null)
      }
    />
  );

  return (
    // 화면을 꽉 채우고 스크롤은 트랜스크립트에만 준다(Shell이 /chat에서 padding 제거).
    <div className="flex h-full min-h-0">
      {/* 데스크톱 세션 목록 (>=lg) */}
      <aside className="hidden w-64 shrink-0 border-r border-border lg:block">
        {sessionList}
      </aside>

      {/* 모바일 세션 목록 드로어 (<lg) */}
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="left-0 top-0 h-dvh w-80 max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-l-0 p-0 data-[state=open]:animate-none">
          <DialogTitle className="sr-only">대화 목록</DialogTitle>
          {sessionList}
        </DialogContent>
      </Dialog>

      {/* 대화 삭제 확인 */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent className="max-w-sm font-sans">
          <DialogHeader>
            <DialogTitle>대화를 삭제할까요?</DialogTitle>
            <DialogDescription>
              &ldquo;{pendingDelete?.title || "새 대화"}&rdquo;의 대화 내역이
              삭제됩니다. 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingDelete && deleteSession(pendingDelete.id)}
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 터미널 */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col font-mono text-[13px] leading-relaxed">
        {/* CLI 기동 배너 — 상단 고정 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          {/* 모바일 목록 열기 */}
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 lg:hidden"
            onClick={() => setListOpen(true)}
            aria-label="대화 목록 열기"
          >
            <PanelLeft className="size-5" />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="select-none text-accent">✻</span>
              <span className="truncate font-semibold">
                {activeProject?.name ?? "프로젝트 미선택"}
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {/* 실행 중인 브랜치 — clone 전이면 표시하지 않는다(거짓 정보 방지) */}
              {branch && (
                <span
                  className="flex min-w-0 items-center gap-1"
                  title={`관리 clone의 현재 브랜치: ${branch}`}
                >
                  <GitBranch className="size-3.5 shrink-0" />
                  <span className="truncate">{branch}</span>
                </span>
              )}
              {activeSession && (
                <span className="truncate">
                  {activeSession.title || "새 대화"}
                </span>
              )}
            </div>
          </div>
        </div>

        {!activeId ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-muted-foreground">
            대화를 선택하거나 새로 시작하세요.
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-3"
            >
              {loadingMsgs ? (
                <div className="text-muted-foreground">불러오는 중…</div>
              ) : messages.length === 0 ? (
                <div className="text-muted-foreground">
                  메시지를 입력해 세션을 시작하세요.
                </div>
              ) : (
                messages.map((m, i) =>
                  // 키는 저장 id 우선, 없으면 세션을 접두사로 붙인 인덱스.
                  // 순수 인덱스만 쓰면 세션을 옮길 때 React가 같은 위치의
                  // 컴포넌트를 재사용해 도구 줄의 펼침 상태가 엉뚱한 줄로 옮겨간다.
                  m.role === "user" ? (
                    <UserLine key={m.id ?? `${activeId}:${i}`} text={m.content} />
                  ) : (
                    <div
                      key={m.id ?? `${activeId}:${i}`}
                      className="min-w-0 space-y-1"
                    >
                      {m.parts && m.parts.length > 0 ? (
                        <AssistantParts parts={m.parts} />
                      ) : m.content ? (
                        // 구 메시지(parts 없음) 폴백
                        <AssistantLine text={m.content} />
                      ) : streaming ? (
                        <ThinkingLine />
                      ) : null}
                    </div>
                  ),
                )
              )}
            </div>

            {/* 입력 — 하단 고정. 모바일 홈바를 피하도록 safe-area를 더한다. */}
            <form
              className="shrink-0 border-t border-border px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <div className="flex items-end gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-accent">
                <span className="select-none pb-1.5 text-accent">&gt;</span>
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    // 직접 타이핑하면 히스토리 탐색을 벗어난다.
                    if (histIndex !== -1) setHistIndex(-1);
                  }}
                  onKeyDown={(e) => {
                    // 모바일은 Enter=줄바꿈(전송은 버튼으로). 데스크톱만 Enter 전송.
                    if (e.key === "Enter" && !e.shiftKey && !isNarrow) {
                      e.preventDefault();
                      send();
                      return;
                    }
                    // ↑/↓ 히스토리 — 커서가 해당 방향 경계에 있을 때만 가로챈다.
                    // (여러 줄 입력에서 커서 이동을 빼앗지 않기 위함)
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      const el = e.currentTarget;
                      // 선택 영역이 있으면 커서 이동이 우선
                      if (el.selectionStart !== el.selectionEnd) return;
                      const atStart = el.selectionStart === 0;
                      const atEnd = el.selectionStart === el.value.length;
                      if (e.key === "ArrowUp" && atStart) {
                        e.preventDefault();
                        navigateHistory(-1);
                      } else if (e.key === "ArrowDown" && atEnd) {
                        e.preventDefault();
                        navigateHistory(1);
                      }
                    }
                  }}
                  placeholder={streaming ? "실행 중…" : "무엇을 도와드릴까요?"}
                  // 16px(text-base) — iOS Safari가 폰트 16px 미만이면 확대한다.
                  className="max-h-40 min-h-7 flex-1 resize-none border-0 bg-transparent px-0 py-1 font-mono text-base shadow-none focus-visible:ring-0 lg:text-[13px]"
                  rows={1}
                />
                {/* 실행 중에는 중단 버튼 — 터치에는 esc가 없다 */}
                {streaming ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={stopStreaming}
                    className="size-9 shrink-0 text-destructive"
                    aria-label="실행 중단"
                  >
                    <Square className="size-4" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!input.trim()}
                    className="size-9 shrink-0"
                    aria-label="전송"
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                )}
              </div>
              <div className="mt-1 flex items-center gap-x-4 px-2 text-xs text-muted-foreground">
                {/* 키보드 힌트는 데스크톱에만 의미가 있다 */}
                <span className="hidden lg:inline">⏎ 전송</span>
                <span className="hidden lg:inline">⇧⏎ 줄바꿈</span>
                <span className="hidden lg:inline">↑↓ 히스토리</span>
                {streaming && (
                  <span className="hidden lg:inline">esc 중단</span>
                )}
                {/* 재시도 중 — 내용이 다시 흐르면 사라진다 */}
                {retrying && (
                  <span className="text-warning">
                    재시도 {retrying.attempt}
                    {retrying.maxRetries > 0 && `/${retrying.maxRetries}`} —{" "}
                    {retrying.reason}
                  </span>
                )}
                {/* 사고 토큰 — 실행 중 누적되며 실행이 끝나도 결과로 남긴다 */}
                {thinkingTokens > 0 && (
                  <span className="ml-auto tabular-nums">
                    사고 {formatTokens(thinkingTokens)} 토큰
                  </span>
                )}
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
