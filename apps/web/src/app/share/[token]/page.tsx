"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Bot, Plus } from "lucide-react";
import { toast } from "sonner";
import { issueSourceLabel, issueStatusLabel } from "@claude-app/shared";
import { api, upload, uploadUrl } from "@/lib/api";
import { StatusBadge, Mono } from "@/components/StatusBadge";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface PublicView {
  scope: string;
  canReport: boolean;
  project: {
    id: string;
    name: string;
    description: string | null;
    gitRepo: string | null;
  };
  issues: Array<{
    id: string;
    title: string;
    status: string;
    source: string;
    issueNumber: number | null;
    createdAt: string;
  }>;
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<PublicView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reporter, setReporter] = useState("");
  // 이미지 업로드 대상으로 미리 만들어 둔 초안 이슈 id. 첫 이미지 첨부 시 생성.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await api.get<PublicView>(`/public/share/${token}`, false);
      setView(v);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 본문에 붙여넣은 이미지를 업로드하고 마크다운에 넣을 URL을 돌려준다.
   * 업로드에는 대상 이슈가 필요하므로, 없으면 초안을 먼저 만든다(제목 입력 전에도 가능).
   */
  async function uploadImage(file: File): Promise<string> {
    let id = draftId;
    if (!id) {
      const draft = await api.post<{ id: string }>(
        `/public/share/${token}/issue-drafts`,
        undefined,
        false,
      );
      id = draft.id;
      setDraftId(id);
    }
    const form = new FormData();
    form.append("files", file);
    const res = await upload<{ images: string[] }>(
      `/public/share/${token}/issues/${id}/images`,
      form,
      false,
    );
    return uploadUrl(res.images[res.images.length - 1]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // 초안이 있으면 그 초안을 확정한다(새 이슈를 또 만들지 않음).
      await api.post(
        `/public/share/${token}/issues`,
        { title, body, reporter, issueId: draftId ?? undefined },
        false,
      );
      toast.success("이슈가 등록되었습니다. 감사합니다!");
      setTitle("");
      setBody("");
      setReporter("");
      setDraftId(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !view) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
        <Card>
          <CardHeader>
            <CardTitle>접근 불가</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6 lg:p-8">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
      <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Bot className="size-4 text-accent" />
        더원 에이전트 · 공유 링크
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{view.project.name}</h1>
      {view.project.description && (
        <p className="mt-1 text-sm text-muted-foreground">
          {view.project.description}
        </p>
      )}
      {view.project.gitRepo && (
        <p className="mt-1">
          <Mono>{view.project.gitRepo}</Mono>
        </p>
      )}

      {view.canReport && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-sm">이슈 등록</CardTitle>
            <p className="text-sm text-muted-foreground">
              로그인 없이 이슈를 등록할 수 있습니다.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-title">제목 *</Label>
                <Input
                  id="s-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>내용 (마크다운 · 이미지 붙여넣기/드래그 가능)</Label>
                <MarkdownEditor
                  value={body}
                  onChange={setBody}
                  onUploadImage={uploadImage}
                  placeholder="어떤 문제가 있었는지 적어주세요. 이미지를 붙여넣거나 드래그하면 자동 업로드됩니다."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-reporter">작성자 (선택)</Label>
                <Input
                  id="s-reporter"
                  value={reporter}
                  onChange={(e) => setReporter(e.target.value)}
                  placeholder="이름/이메일"
                />
              </div>
              <Button type="submit" disabled={busy || !title.trim()}>
                <Plus className="size-4" />
                {busy ? "등록 중..." : "이슈 등록"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-sm">이슈 ({view.issues.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {view.issues.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              등록된 이슈가 없습니다.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {view.issues.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center gap-3 py-2.5 text-sm"
                >
                  <Mono>
                    {i.issueNumber
                      ? `#${i.issueNumber}`
                      : issueSourceLabel(i.source)}
                  </Mono>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <StatusBadge
                    status={i.status}
                    label={issueStatusLabel(i.status)}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
