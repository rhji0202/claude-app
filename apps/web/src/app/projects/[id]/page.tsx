"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Copy, Play, Trash2, X, Plus } from "lucide-react";
import { toast } from "sonner";
import type { Project, ShareLinkScope, UserRole } from "@claude-app/shared";
import { api } from "@/lib/api";
import { Mono } from "@/components/StatusBadge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface Share {
  userId: string;
  email: string;
  name: string | null;
  role: UserRole;
}
interface ShareLink {
  id: string;
  token: string;
  scope: ShareLinkScope;
  expiresAt: string | null;
  createdAt: string;
}
interface NamedRef {
  id: string;
  name: string;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [allSkills, setAllSkills] = useState<NamedRef[]>([]);
  const [attachedSkills, setAttachedSkills] = useState<NamedRef[]>([]);
  const [allMcp, setAllMcp] = useState<NamedRef[]>([]);
  const [attachedMcp, setAttachedMcp] = useState<NamedRef[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"viewer" | "editor">("viewer");
  const [linkScope, setLinkScope] = useState<ShareLinkScope>("issue_report");
  const [skillSel, setSkillSel] = useState("");
  const [mcpSel, setMcpSel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [runResult, setRunResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, sh, lk, sk, ask, mc, amc] = await Promise.all([
        api.get<Project>(`/projects/${id}`),
        api.get<Share[]>(`/projects/${id}/shares`),
        api.get<ShareLink[]>(`/projects/${id}/share-links`),
        api.get<NamedRef[]>(`/skills`),
        api.get<NamedRef[]>(`/projects/${id}/skills`),
        api.get<NamedRef[]>(`/mcp`),
        api.get<NamedRef[]>(`/projects/${id}/mcp`),
      ]);
      setProject(p);
      setShares(sh);
      setLinks(lk);
      setAllSkills(sk);
      setAttachedSkills(ask);
      setAllMcp(mc);
      setAttachedMcp(amc);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const wrap = (fn: () => Promise<unknown>, ok?: string) => async () => {
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  async function runAgent() {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await api.post<{ status: string; text: string; error?: string }>(
        `/projects/${id}/run`,
        { prompt },
      );
      if (res.status === "ok") {
        setRunResult(res.text);
        toast.success("실행 완료");
      } else {
        setRunResult(`오류: ${res.error}`);
        toast.error("실행 오류");
      }
    } catch (e) {
      setRunResult(`오류: ${(e as Error).message}`);
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function copyLink(url: string) {
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast.success("링크가 복사되었습니다."))
      .catch(() => toast.error("복사에 실패했습니다."));
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  if (!project) {
    return (
      <div className="space-y-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/projects"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        프로젝트
      </Link>
      <h1 className="mt-2 text-xl font-bold tracking-tight md:text-2xl">
        {project.name}
      </h1>
      <p className="mt-1">
        <Mono>{project.cwd}</Mono>
      </p>

      <div className="mt-6 space-y-5">
        {/* 팀 공유 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">팀 공유</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="user@email.com"
                type="email"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                className="flex-1"
              />
              <Select
                value={shareRole}
                onValueChange={(v) => setShareRole(v as "viewer" | "editor")}
              >
                <SelectTrigger className="sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">viewer</SelectItem>
                  <SelectItem value="editor">editor</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={wrap(async () => {
                  await api.post(`/projects/${id}/shares`, {
                    email: shareEmail,
                    role: shareRole,
                  });
                  setShareEmail("");
                }, "공유했습니다.")}
              >
                <Plus className="size-4" />
                공유
              </Button>
            </div>
            {shares.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                공유된 팀원이 없습니다.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {shares.map((s) => (
                  <li
                    key={s.userId}
                    className="flex items-center gap-3 py-2.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{s.email}</span>
                    <Badge variant="muted">{s.role}</Badge>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={wrap(
                        () => api.del(`/projects/${id}/shares/${s.userId}`),
                        "해제했습니다.",
                      )}
                    >
                      해제
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 공유 링크 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">공유 링크</CardTitle>
            <p className="text-sm text-muted-foreground">
              <Mono>read</Mono>: 읽기 전용 대시보드 · <Mono>issue_report</Mono>:
              테스터가 로그인 없이 이슈 등록
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={linkScope}
                onValueChange={(v) => setLinkScope(v as ShareLinkScope)}
              >
                <SelectTrigger className="sm:flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="issue_report">
                    issue_report (이슈 등록)
                  </SelectItem>
                  <SelectItem value="read">read (읽기 전용)</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={wrap(
                  () => api.post(`/projects/${id}/share-links`, { scope: linkScope }),
                  "링크를 발급했습니다.",
                )}
              >
                <Plus className="size-4" />
                링크 발급
              </Button>
            </div>
            {links.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                발급된 링크가 없습니다.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {links.map((l) => {
                  const url = `${origin}/share/${l.token}`;
                  return (
                    <li
                      key={l.id}
                      className="flex flex-wrap items-center gap-2 py-2.5 text-sm"
                    >
                      <Badge variant="muted">{l.scope}</Badge>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate"
                      >
                        <Mono>{url}</Mono>
                      </a>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => copyLink(url)}
                      >
                        <Copy className="size-4" />
                        복사
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={wrap(
                          () => api.del(`/share-links/${l.id}`),
                          "폐기했습니다.",
                        )}
                      >
                        폐기
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 스킬 / MCP 연결 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">스킬 · MCP 연결</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <AttachRow
              label="스킬"
              all={allSkills}
              attached={attachedSkills}
              selected={skillSel}
              onSelect={setSkillSel}
              onAttach={wrap(async () => {
                if (skillSel)
                  await api.post(`/projects/${id}/skills`, { skillId: skillSel });
                setSkillSel("");
              }, "연결했습니다.")}
              onDetach={(sid) =>
                wrap(
                  () => api.del(`/projects/${id}/skills/${sid}`),
                  "해제했습니다.",
                )()
              }
            />
            <AttachRow
              label="MCP"
              all={allMcp}
              attached={attachedMcp}
              selected={mcpSel}
              onSelect={setMcpSel}
              onAttach={wrap(async () => {
                if (mcpSel)
                  await api.post(`/projects/${id}/mcp`, { mcpServerId: mcpSel });
                setMcpSel("");
              }, "연결했습니다.")}
              onDetach={(mid) =>
                wrap(() => api.del(`/projects/${id}/mcp/${mid}`), "해제했습니다.")()
              }
            />
          </CardContent>
        </Card>

        {/* 임의 실행 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">에이전트 실행</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="이 프로젝트 컨텍스트에서 실행할 프롬프트"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="mt-3">
              <Button disabled={running || !prompt} onClick={runAgent}>
                <Play className="size-4" />
                {running ? "실행 중..." : "실행"}
              </Button>
            </div>
            {running && !runResult && (
              <Skeleton className="mt-3 h-24 w-full" />
            )}
            {runResult && (
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                {runResult}
              </pre>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AttachRow({
  label,
  all,
  attached,
  selected,
  onSelect,
  onAttach,
  onDetach,
}: {
  label: string;
  all: NamedRef[];
  attached: NamedRef[];
  selected: string;
  onSelect: (v: string) => void;
  onAttach: () => void;
  onDetach: (id: string) => void;
}) {
  const attachedIds = new Set(attached.map((a) => a.id));
  const available = all.filter((a) => !attachedIds.has(a.id));
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <strong className="text-sm sm:w-12">{label}</strong>
        <Select value={selected} onValueChange={onSelect}>
          <SelectTrigger className="sm:flex-1">
            <SelectValue placeholder="선택..." />
          </SelectTrigger>
          <SelectContent>
            {available.length === 0 ? (
              <div className="px-2 py-2 text-sm text-muted-foreground">
                추가할 항목 없음
              </div>
            ) : (
              available.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Button variant="secondary" size="sm" onClick={onAttach}>
          연결
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 sm:pl-14">
        {attached.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            연결된 {label} 없음
          </span>
        ) : (
          attached.map((a) => (
            <Badge key={a.id} variant="success" className="gap-1.5">
              {a.name}
              <button
                type="button"
                className="cursor-pointer opacity-70 hover:opacity-100"
                onClick={() => onDetach(a.id)}
                aria-label={`${a.name} 해제`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}
