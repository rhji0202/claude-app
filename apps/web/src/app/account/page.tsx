"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Trash2, Plus, KeyRound, UserCog } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { Mono } from "@/components/StatusBadge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface ClaudeAccount {
  id: string;
  label: string;
  accountEmail: string | null;
  subscriptionType: string | null;
  isActive: boolean;
  tokenPreview: string;
  model: string | null;
  effort: string | null;
  monthlyBudgetUsd: number | null;
  createdAt: string;
}

// 선택 가능한 모델(빈 값 = 전역 기본). 최신 모델 위주.
// Haiku 4.5는 effort 파라미터를 지원하지 않는다.
const MODEL_OPTIONS = [
  { value: "", label: "기본(서버 설정)" },
  { value: "claude-opus-5", label: "Opus 5" },
  { value: "claude-fable-5", label: "Fable 5" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
  { value: "claude-opus-4-8", label: "Opus 4.8" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
];
const EFFORT_OPTIONS = [
  { value: "", label: "기본" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
  { value: "max", label: "max" },
];

export default function AccountPage() {
  const [accounts, setAccounts] = useState<ClaudeAccount[] | null>(null);
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setAccounts(await api.get<ClaudeAccount[]>("/claude-accounts"));
    } catch (e) {
      toast.error((e as Error).message);
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/claude-accounts", {
        token: token.trim(),
        label: label || undefined,
      });
      toast.success("Claude 계정이 연결되었습니다.");
      setToken("");
      setLabel("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function activate(id: string) {
    try {
      await api.post(`/claude-accounts/${id}/activate`);
      toast.success("활성 계정으로 전환했습니다.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(id: string) {
    try {
      await api.del(`/claude-accounts/${id}`);
      toast.success("계정을 삭제했습니다.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // 계정별 모델·effort·월예산 저장(빈 값이면 전역 기본/무제한).
  async function saveAccount(
    id: string,
    patch: { model?: string; effort?: string; monthlyBudgetUsd?: number | null },
  ) {
    try {
      await api.patch(`/claude-accounts/${id}`, patch);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div>
      <PageHeader title="계정">
        내 프로필과 Claude 계정 연결을 관리합니다.
      </PageHeader>

      <ProfileCard />

      {/* 연결 안내 + 폼 */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-sm">계정 연결</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">토큰 발급 방법</p>
            <p>
              로컬 터미널에서 아래 명령을 실행해 1년짜리 토큰을 발급받은 뒤, 출력된{" "}
              <Mono>sk-ant-oat01-…</Mono> 값을 붙여넣으세요. (Claude 구독 필요)
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
              claude setup-token
            </pre>
          </div>

          <form onSubmit={addAccount} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="token">토큰</Label>
              <Input
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="sk-ant-oat01-..."
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label">계정 라벨 (선택)</Label>
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="예: 회사 계정"
              />
            </div>
            <Button type="submit" disabled={submitting || !token}>
              <Plus className="size-4" />
              {submitting ? "연결 중..." : "계정 연결"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 목록 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">연결된 계정</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts === null ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : accounts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              연결된 계정이 없습니다. 위에서 토큰을 연결하세요.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {accounts.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{a.label}</span>
                      {a.isActive && (
                        <Badge variant="success">
                          <CheckCircle2 className="size-3" />
                          활성
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5">
                      <Mono>{a.tokenPreview}</Mono>
                    </div>
                    {/* 계정별 실행 모델·effort (빈 값 = 서버 기본) */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label className="text-xs text-muted-foreground">모델</label>
                      <select
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                        value={a.model ?? ""}
                        onChange={(e) => saveAccount(a.id, { model: e.target.value })}
                      >
                        {MODEL_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <label className="text-xs text-muted-foreground">effort</label>
                      <select
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                        value={a.effort ?? ""}
                        onChange={(e) => saveAccount(a.id, { effort: e.target.value })}
                      >
                        {EFFORT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <BudgetInput
                        value={a.monthlyBudgetUsd}
                        onSave={(v) =>
                          saveAccount(a.id, { monthlyBudgetUsd: v })
                        }
                      />
                    </div>
                  </div>
                  {!a.isActive && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => activate(a.id)}
                    >
                      활성화
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(a.id)}
                  >
                    <Trash2 className="size-4" />
                    삭제
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * 계정 월 예산(USD) 입력. 빈 값/0 = 무제한(null).
 * blur 또는 Enter 시, 값이 바뀐 경우에만 저장한다(매 키입력마다 PATCH 방지).
 */
function BudgetInput({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (v: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));

  // 외부(다른 저장 후 reload)에서 값이 바뀌면 동기화.
  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);

  function commit() {
    const trimmed = text.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next != null && (Number.isNaN(next) || next < 0)) {
      setText(value == null ? "" : String(value)); // 잘못된 값은 되돌림
      return;
    }
    if (next === value) return; // 변경 없음
    onSave(next);
  }

  return (
    <>
      <label className="text-xs text-muted-foreground">월 예산 $</label>
      <input
        type="number"
        min={0}
        step="1"
        className="w-24 rounded-md border border-border bg-background px-2 py-1 text-xs"
        placeholder="무제한"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </>
  );
}

/** 내 프로필: 이름·비밀번호 셀프 편집 */
function ProfileCard() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      if (name !== (user?.name ?? "")) body.name = name;
      if (newPassword) {
        body.currentPassword = currentPassword;
        body.newPassword = newPassword;
      }
      if (Object.keys(body).length === 0) {
        toast.info("변경 사항이 없습니다.");
        return;
      }
      await api.patch("/auth/me", body);
      toast.success("프로필을 저장했습니다.");
      setCurrentPassword("");
      setNewPassword("");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <UserCog className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm">내 프로필</CardTitle>
          {user?.role === "admin" && <Badge variant="success">admin</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>이메일</Label>
            <Input value={user?.email ?? ""} disabled />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-name">이름</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-cur">현재 비밀번호</Label>
              <Input
                id="p-cur"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-new">새 비밀번호 (8자 이상)</Label>
              <Input
                id="p-new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "저장 중..." : "저장"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
