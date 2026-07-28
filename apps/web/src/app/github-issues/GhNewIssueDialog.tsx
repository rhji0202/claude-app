"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import type { GhIssue, GhLabel } from "@claude-app/shared";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GhLabelChip } from "./GhLabelChip";

/**
 * GitHub에 새 이슈를 등록하는 다이얼로그.
 * ⚠️ GitHub Issue 뷰어 전용 — 에이전트 큐에 이슈를 만들지 않는다
 * (docs/rules/github-issue-separation.md).
 */
export function GhNewIssueDialog({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: (issue: GhIssue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [repoLabels, setRepoLabels] = useState<GhLabel[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      try {
        const list = await api.get<GhLabel[]>(`/gh-issues/${projectId}/labels`);
        if (alive) setRepoLabels(list);
      } catch {
        /* 라벨 조회 실패는 무시(라벨 없이 등록 가능) */
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, projectId]);

  function reset() {
    setTitle("");
    setBody("");
    setLabels([]);
  }

  async function submit() {
    const t = title.trim();
    if (!t) {
      toast.error("제목을 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<GhIssue>(`/gh-issues/${projectId}`, {
        title: t,
        body,
        labels,
      });
      toast.success(`#${created.number} 이슈를 등록했습니다.`);
      onCreated(created);
      reset();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "이슈 등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />새 이슈
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>새 GitHub 이슈</DialogTitle>
          <DialogDescription>
            연결된 저장소에 이슈를 직접 등록합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="gh-new-title">제목</Label>
            <Input
              id="gh-new-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="이슈 제목"
            />
          </div>

          <div className="space-y-1.5">
            <Label>본문</Label>
            <MarkdownEditor
              value={body}
              onChange={setBody}
              placeholder="재현 방법, 기대 동작 등 (마크다운)"
              minRows={6}
            />
          </div>

          {repoLabels.length > 0 && (
            <div className="space-y-1.5">
              <Label>라벨</Label>
              <div className="flex flex-wrap gap-1.5">
                {repoLabels.map((l) => (
                  <GhLabelChip
                    key={l.id || l.name}
                    label={l}
                    active={labels.includes(l.name)}
                    onClick={(name) =>
                      setLabels((prev) =>
                        prev.includes(name)
                          ? prev.filter((x) => x !== name)
                          : [...prev, name],
                      )
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
