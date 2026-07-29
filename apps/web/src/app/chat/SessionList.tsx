"use client";

import { FolderGit2, MessageSquare, Plus, Trash2 } from "lucide-react";
import { cn, formatAbsolute, formatRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * 채팅 세션 목록 — 데스크톱 사이드바와 모바일 드로어가 함께 쓴다.
 *
 * 삭제 버튼은 hover로 감추지 않는다(터치에서 도달 불가). 대신 항상 노출하고
 * muted 색으로 눌러 시선을 빼앗지 않는다.
 */

export interface Project {
  id: string;
  name: string;
}
export interface ChatSession {
  id: string;
  projectId: string;
  title: string | null;
  updatedAt: string;
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

export function SessionList({
  projects,
  sessions,
  activeId,
  newProjectId,
  onNewProjectIdChange,
  onNewSession,
  onOpenSession,
  onDeleteSession,
}: {
  projects: Project[];
  sessions: ChatSession[];
  activeId: string | null;
  newProjectId: string;
  onNewProjectIdChange: (id: string) => void;
  onNewSession: () => void;
  onOpenSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 새 대화 — 목록이 길어도 항상 보이도록 상단 고정 */}
      <div className="flex shrink-0 gap-2 border-b border-border p-3">
        <Select value={newProjectId} onValueChange={onNewProjectIdChange}>
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
        <Button size="icon" onClick={onNewSession} aria-label="새 대화">
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
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
                  <span className="ml-auto tabular-nums">{items.length}</span>
                </div>
                {items.map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      "flex items-center gap-1 rounded-md pl-2.5 pr-1 transition-colors",
                      activeId === s.id
                        ? "bg-accent/15 text-accent"
                        : "hover:bg-secondary",
                    )}
                  >
                    <button
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm"
                      onClick={() => onOpenSession(s.id)}
                    >
                      <MessageSquare className="size-4 shrink-0" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{s.title || "새 대화"}</span>
                        <span
                          className="text-xs text-muted-foreground"
                          title={formatAbsolute(s.updatedAt)}
                        >
                          {formatRelative(s.updatedAt)}
                        </span>
                      </span>
                    </button>
                    {/* 터치에서도 항상 보이는 삭제 — hover 의존 금지 */}
                    <button
                      className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive md:size-9"
                      onClick={() => onDeleteSession(s.id)}
                      aria-label={`${s.title || "새 대화"} 삭제`}
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
    </div>
  );
}
