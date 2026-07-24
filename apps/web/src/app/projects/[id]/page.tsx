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
  // 이슈 자동화(autoPr/autoMerge) 설정 로컬 편집 상태
  const [autoPr, setAutoPr] = useState(false);
  const [autoMerge, setAutoMerge] = useState(false);
  const [autoTriage, setAutoTriage] = useState(false);
  const [savingPr, setSavingPr] = useState(false);
  // 알림 webhook (시크릿: 값은 안 내려오고 보유 여부만) — 입력하면 저장, 비우고 저장하면 해제
  const [webhookInput, setWebhookInput] = useState("");
  const [savingHook, setSavingHook] = useState(false);
  // 월 예산(USD). 빈 문자열 = 무제한. 저장 시 null(해제) 또는 숫자.
  const [budgetInput, setBudgetInput] = useState("");
  const [savingBudget, setSavingBudget] = useState(false);

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
      setAutoPr(Boolean(p.autoPr));
      setAutoMerge(Boolean(p.autoMerge));
      setAutoTriage(Boolean(p.autoTriage));
      setBudgetInput(
        p.monthlyBudgetUsd != null ? String(p.monthlyBudgetUsd) : "",
      );
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

  async function saveAutomation() {
    setSavingPr(true);
    try {
      // autoMerge는 autoPr가 켜져 있을 때만 의미 있음 → 함께 정리해 저장.
      const nextMerge = autoPr ? autoMerge : false;
      await api.patch(`/projects/${id}`, {
        autoPr,
        autoMerge: nextMerge,
        autoTriage,
      });
      setAutoMerge(nextMerge);
      toast.success("이슈 자동화 설정을 저장했습니다.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingPr(false);
    }
  }

  async function saveWebhook(clear = false) {
    setSavingHook(true);
    try {
      // clear면 ""로 보내 해제, 아니면 입력값 저장.
      await api.patch(`/projects/${id}`, {
        notifyWebhook: clear ? "" : webhookInput.trim(),
      });
      setWebhookInput("");
      toast.success(clear ? "알림 webhook을 해제했습니다." : "알림 webhook을 저장했습니다.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingHook(false);
    }
  }

  async function saveBudget(clear = false) {
    setSavingBudget(true);
    try {
      // clear면 null(무제한 해제), 아니면 숫자로 파싱해 저장.
      const value = clear ? null : Number(budgetInput);
      if (!clear && (!isFinite(value as number) || (value as number) < 0)) {
        toast.error("0 이상의 숫자를 입력하세요.");
        return;
      }
      await api.patch(`/projects/${id}`, { monthlyBudgetUsd: value });
      toast.success(clear ? "월 예산을 해제했습니다." : "월 예산을 저장했습니다.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingBudget(false);
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
        <Mono>
          {project.gitRepo ?? "gitRepo 미설정 — 실행하려면 저장소를 연결하세요"}
        </Mono>
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

        {/* 이슈 자동화 (PR) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">이슈 자동화</CardTitle>
            <p className="text-sm text-muted-foreground">
              이슈 실행 시 에이전트가 변경사항을 브랜치로 push하고 Pull Request를
              만듭니다. (<Mono>gh</Mono> CLI 사용 · <Mono>gitRepo</Mono> 필요)
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {!project.gitRepo && (
              <p className="rounded-md border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                이 프로젝트에 <Mono>gitRepo</Mono>가 설정되어 있지 않아 자동 PR이
                동작하지 않습니다. 먼저 저장소를 연결하세요.
              </p>
            )}
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={autoTriage}
                onChange={(e) => setAutoTriage(e.target.checked)}
              />
              <span>
                <strong className="font-medium">자동 분류(triage)</strong>
                <span className="text-muted-foreground">
                  {" "}
                  — 실행 시 이슈를 자동수정/결정필요/정보부족/질문으로 분류하고
                  라벨·코멘트 반영
                </span>
              </span>
            </label>
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={autoPr}
                onChange={(e) => setAutoPr(e.target.checked)}
              />
              <span>
                <strong className="font-medium">자동 PR 생성</strong>
                <span className="text-muted-foreground">
                  {" "}
                  — 이슈 해결 후 <Mono>issue/&lt;id&gt;</Mono> 브랜치로 PR 생성
                </span>
              </span>
            </label>
            <label
              className={`flex items-center gap-2.5 text-sm ${
                autoPr ? "" : "pointer-events-none opacity-50"
              }`}
            >
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={autoMerge}
                disabled={!autoPr}
                onChange={(e) => setAutoMerge(e.target.checked)}
              />
              <span>
                <strong className="font-medium">자동 머지</strong>
                <span className="text-muted-foreground">
                  {" "}
                  — PR의 체크가 통과하면 자동 머지(<Mono>--auto --squash</Mono>)
                </span>
              </span>
            </label>
            <div>
              <Button onClick={saveAutomation} disabled={savingPr}>
                {savingPr ? "저장 중..." : "저장"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 알림 webhook */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">알림</CardTitle>
            <p className="text-sm text-muted-foreground">
              크론 실패·이슈 완료/실패·PR 생성 시 webhook으로 알림을 보냅니다.
              (Slack·Discord·WeCom 등 incoming webhook URL)
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">현재 상태:</span>
              {project.secrets.hasNotifyWebhook ? (
                <Badge variant="success">설정됨</Badge>
              ) : (
                <Badge variant="muted">미설정</Badge>
              )}
            </div>
            <Input
              type="url"
              placeholder="https://hooks.slack.com/services/..."
              value={webhookInput}
              onChange={(e) => setWebhookInput(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                onClick={() => saveWebhook(false)}
                disabled={savingHook || !webhookInput.trim()}
              >
                {savingHook ? "저장 중..." : "저장"}
              </Button>
              {project.secrets.hasNotifyWebhook && (
                <Button
                  variant="secondary"
                  onClick={() => saveWebhook(true)}
                  disabled={savingHook}
                >
                  해제
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 월 예산 가드레일 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">월 예산</CardTitle>
            <p className="text-sm text-muted-foreground">
              이번 달 누적 예상 비용이 이 금액에 도달하면 워커가 이 프로젝트의 이슈
              실행을 보류합니다. 비우면 무제한입니다.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">현재:</span>
              {project.monthlyBudgetUsd != null ? (
                <Badge variant="success">${project.monthlyBudgetUsd} / 월</Badge>
              ) : (
                <Badge variant="muted">무제한</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="예: 50"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="max-w-[10rem]"
              />
              <span className="text-sm text-muted-foreground">/ 월</span>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => saveBudget(false)}
                disabled={savingBudget || !budgetInput.trim()}
              >
                {savingBudget ? "저장 중..." : "저장"}
              </Button>
              {project.monthlyBudgetUsd != null && (
                <Button
                  variant="secondary"
                  onClick={() => saveBudget(true)}
                  disabled={savingBudget}
                >
                  해제
                </Button>
              )}
            </div>
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
