"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { api, upload } from "@/lib/api";
import { StatusBadge, Mono } from "@/components/StatusBadge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  const [files, setFiles] = useState<File[]>([]);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await api.post<{ id: string }>(
        `/public/share/${token}/issues`,
        { title, body, reporter },
        false,
      );
      // 첨부 이미지 업로드 (있으면)
      if (files.length > 0 && created?.id) {
        const form = new FormData();
        files.forEach((f) => form.append("files", f));
        await upload(
          `/public/share/${token}/issues/${created.id}/images`,
          form,
          false,
        );
      }
      toast.success("이슈가 등록되었습니다. 감사합니다!");
      setTitle("");
      setBody("");
      setFiles([]);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !view) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
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
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
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
                <Label htmlFor="s-body">내용</Label>
                <Textarea
                  id="s-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-images">이미지 첨부 (선택, 여러 개 가능)</Label>
                <Input
                  id="s-images"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
                {files.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {files.length}개 선택됨
                  </p>
                )}
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
              <Button type="submit" disabled={busy || !title}>
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
                  <Mono>{i.issueNumber ? `#${i.issueNumber}` : i.source}</Mono>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <StatusBadge status={i.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
