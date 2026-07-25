"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Plus,
  Send,
  Trash2,
  User,
  MessageSquare,
  FolderGit2,
  FilePen,
} from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/Markdown";
import {
  ToolPart,
  editedFilesFromLog,
  fileBasename,
} from "@/components/ToolPart";
import { api, streamPost } from "@/lib/api";
import { cn, formatAbsolute, formatRelative } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface Project {
  id: string;
  name: string;
}
interface ChatSession {
  id: string;
  projectId: string;
  title: string | null;
  updatedAt: string;
}
/** 순서 있는 파트(claude.ai식 타임라인). text는 id로 delta/end를 매칭. */
type Part =
  | { type: "text"; id: string; text: string; streaming?: boolean }
  | { type: "tool"; id: string; name: string; input?: string };
interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  parts?: Part[];
}
type StreamEvent =
  | { type: "session"; sessionId: string }
  | { type: "text_start"; id: string }
  | { type: "text_delta"; id: string; delta: string }
  | { type: "text_end"; id: string; text: string }
  | { type: "tool"; id: string; name: string; input?: string }
  | { type: "done"; text: string }
  | { type: "error"; error: string };

/**
 * 이벤트 → parts 리듀서. id로 파트를 식별해 delta는 누적, text_end는 확정(교체).
 * → delta와 완결 블록이 같은 파트에 수렴하므로 중복이 원천 차단됨.
 */
function reduceParts(parts: Part[], e: StreamEvent): Part[] {
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
    default:
      return parts;
  }
}

/** 세션을 프로젝트별로 묶는다. 입력이 updatedAt desc이므로 그룹·항목 모두 최신순 유지. */
function groupByProject(
  sessions: ChatSession[],
): { projectId: string; items: ChatSession[] }[] {
  const groups: { projectId: string; items: ChatSession[] }[] = [];
  const index = new Map<string, number>();
  for (const s of sessions) {
    let i = index.get(s.projectId);
    if (i === undefined) {
      i = groups.length;
      index.set(s.projectId, i);
      groups.push({ projectId: s.projectId, items: [] });
    }
    groups[i].items.push(s);
  }
  return groups;
}


/**
 * assistant 메시지의 parts 타임라인.
 * 마지막 text 파트 = 최종 답변(강조), 그 앞 text = 중간 발화(흐림), tool = 칩.
 */
function AssistantParts({ parts }: { parts: Part[] }) {
  const lastTextIdx = parts.reduce(
    (acc, p, i) => (p.type === "text" ? i : acc),
    -1,
  );
  const editedFiles = editedFilesFromLog(
    parts.filter((p): p is Extract<Part, { type: "tool" }> => p.type === "tool"),
  );
  return (
    <div className="min-w-0 space-y-2">
      {editedFiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-secondary/30 px-2.5 py-2 text-xs">
          <FilePen className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium">편집된 파일 {editedFiles.length}개</span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
            {editedFiles.map((f) => fileBasename(f)).join(", ")}
          </span>
        </div>
      )}
      {parts.map((p, i) => {
        if (p.type === "tool") {
          return <ToolPart key={p.id} name={p.name} input={p.input} />;
        }
        const isFinal = i === lastTextIdx;
        if (!p.text && p.streaming) {
          return (
            <div key={p.id} className="text-sm text-muted-foreground">
              …
            </div>
          );
        }
        if (!p.text) return null;
        return (
          <div
            key={p.id}
            className={cn(
              "rounded-lg px-3 py-2 text-sm",
              isFinal ? "bg-secondary" : "bg-secondary/50 text-muted-foreground",
            )}
          >
            <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-pre:my-2">
              {p.text}
            </Markdown>
          </div>
        );
      })}
    </div>
  );
}

export default function ChatPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [newProjectId, setNewProjectId] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

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
    setLoadingMsgs(true);
    try {
      const s = await api.get<{ messages: ChatMessage[] }>(`/chat/sessions/${id}`);
      setMessages(s.messages ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function newSession() {
    if (!newProjectId) return toast.error("프로젝트를 선택하세요.");
    try {
      const s = await api.post<ChatSession>("/chat/sessions", {
        projectId: newProjectId,
      });
      setSessions((prev) => [s, ...prev]);
      setActiveId(s.id);
      setMessages([]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteSession(id: string) {
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
    if (!prompt || !activeId || streaming) return;
    setInput("");
    setMessages((m) => [
      ...m,
      { role: "user", content: prompt },
      // assistant 자리 확보 (parts를 스트리밍으로 채움)
      { role: "assistant", content: "", parts: [] },
    ]);
    setStreaming(true);

    try {
      await streamPost(
        `/chat/sessions/${activeId}/messages`,
        { prompt },
        (raw) => {
          const e = raw as StreamEvent;
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
            e.type === "tool"
          ) {
            patchLast((m) => ({ ...m, parts: reduceParts(m.parts ?? [], e) }));
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
      );
      loadSessions();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div>
      <PageHeader title="채팅">
        프로젝트 컨텍스트에서 에이전트와 대화합니다. 활성 Claude 계정 토큰으로 실행되며,
        대화는 저장됩니다.
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* 세션 목록 */}
        <aside className="space-y-3">
          <div className="flex gap-2">
            <Select value={newProjectId} onValueChange={setNewProjectId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="프로젝트" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="icon" onClick={newSession} aria-label="새 대화">
              <Plus className="size-4" />
            </Button>
          </div>

          <div className="space-y-1">
            {sessions.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">
                대화가 없습니다.
              </p>
            ) : (
              groupByProject(sessions).map(({ projectId, items }) => {
                const proj = projects.find((p) => p.id === projectId);
                return (
                  <div key={projectId} className="mb-3">
                    <div className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <FolderGit2 className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {proj?.name ?? "알 수 없는 프로젝트"}
                      </span>
                      <span className="ml-auto tabular-nums">
                        {items.length}
                      </span>
                    </div>
                    {items.map((s) => (
                      <div
                        key={s.id}
                        className={cn(
                          "group flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                          activeId === s.id
                            ? "bg-accent/15 text-accent"
                            : "hover:bg-secondary",
                        )}
                      >
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => openSession(s.id)}
                        >
                          <MessageSquare className="size-4 shrink-0" />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">
                              {s.title || "새 대화"}
                            </span>
                            <span
                              className="text-xs text-muted-foreground"
                              title={formatAbsolute(s.updatedAt)}
                            >
                              {formatRelative(s.updatedAt)}
                            </span>
                          </span>
                        </button>
                        <button
                          className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                          onClick={() => deleteSession(s.id)}
                          aria-label="대화 삭제"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* 대화 영역 */}
        <section className="flex min-h-[60dvh] flex-col rounded-xl border border-border bg-card">
          {!activeId ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
              프로젝트를 선택하고 새 대화를 시작하세요.
            </div>
          ) : (
            <>
              <div
                ref={scrollRef}
                className="flex-1 space-y-4 overflow-y-auto p-4"
                style={{ maxHeight: "calc(100dvh - 320px)" }}
              >
                {loadingMsgs ? (
                  <>
                    <Skeleton className="h-16 w-3/4" />
                    <Skeleton className="ml-auto h-16 w-2/3" />
                  </>
                ) : messages.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    첫 메시지를 보내보세요.
                  </p>
                ) : (
                  messages.map((m, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex gap-3",
                        m.role === "user" && "flex-row-reverse",
                      )}
                    >
                      <div
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full",
                          m.role === "user"
                            ? "bg-accent/15 text-accent"
                            : "bg-secondary text-foreground",
                        )}
                      >
                        {m.role === "user" ? (
                          <User className="size-4" />
                        ) : (
                          <Bot className="size-4" />
                        )}
                      </div>
                      {m.role === "user" ? (
                        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-accent/15 px-3 py-2 text-sm">
                          {m.content}
                        </div>
                      ) : (
                        <div className="min-w-0 max-w-[85%]">
                          {m.parts && m.parts.length > 0 ? (
                            <AssistantParts parts={m.parts} />
                          ) : m.content ? (
                            // 구 메시지(parts 없음) 폴백: content만 마크다운 렌더
                            <div className="rounded-lg bg-secondary px-3 py-2 text-sm">
                              <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-pre:my-2">
                                {m.content}
                              </Markdown>
                            </div>
                          ) : streaming ? (
                            <div className="rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
                              …
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              <form
                className="flex items-end gap-2 border-t border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
                  className="min-h-[44px] flex-1 resize-none"
                  rows={1}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={streaming || !input.trim()}
                  aria-label="전송"
                >
                  <Send className="size-4" />
                </Button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
