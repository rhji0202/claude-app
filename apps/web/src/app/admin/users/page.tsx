"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, ShieldCheck, ShieldOff, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@claude-app/shared";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  // 생성 폼은 레이어 팝업(다이얼로그)으로 띄운다.
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await api.get<User[]>("/admin/users"));
    } catch (e) {
      toast.error((e as Error).message);
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function resetForm() {
    setEmail("");
    setName("");
    setPassword("");
    setRole("member");
  }

  function openCreate() {
    // 이전에 입력하다 닫은 값이 남지 않도록 열 때마다 초기화.
    resetForm();
    setCreateOpen(true);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/admin/users", {
        email,
        name: name || undefined,
        password,
        role,
      });
      toast.success("사용자를 생성했습니다.");
      resetForm();
      setCreateOpen(false);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, ok: string) {
    try {
      await api.patch(`/admin/users/${id}`, body);
      toast.success(ok);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div>
      <PageHeader title="사용자 관리">
        관리자만 접근할 수 있습니다. 사용자를 생성하고 역할·활성 상태를 관리합니다.
        (자가 회원가입은 닫혀 있습니다.)
      </PageHeader>

      {/* 목록 */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-sm">사용자 목록</CardTitle>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            추가
          </Button>
        </CardHeader>
        <CardContent>
          {users === null ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {users.map((u) => {
                const isSelf = u.id === me?.id;
                return (
                  <li
                    key={u.id}
                    className="flex flex-wrap items-center gap-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {u.name || u.email}
                        </span>
                        {u.role === "admin" && (
                          <Badge variant="success">admin</Badge>
                        )}
                        {u.disabled && (
                          <Badge variant="destructive">비활성</Badge>
                        )}
                        {isSelf && <Badge variant="muted">나</Badge>}
                      </div>
                      <Mono>{u.email}</Mono>
                    </div>

                    {/* 역할 토글 */}
                    {u.role === "admin" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          patch(u.id, { role: "member" }, "member로 변경했습니다.")
                        }
                      >
                        <ShieldOff className="size-4" />
                        강등
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          patch(u.id, { role: "admin" }, "admin으로 승격했습니다.")
                        }
                      >
                        <ShieldCheck className="size-4" />
                        승격
                      </Button>
                    )}

                    {/* 활성/비활성 토글 (자기 자신 비활성화 불가) */}
                    {u.disabled ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          patch(u.id, { disabled: false }, "활성화했습니다.")
                        }
                      >
                        <UserCheck className="size-4" />
                        활성화
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isSelf}
                        onClick={() =>
                          patch(u.id, { disabled: true }, "비활성화했습니다.")
                        }
                      >
                        <UserX className="size-4" />
                        비활성화
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 생성 다이얼로그 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>사용자 생성</DialogTitle>
          </DialogHeader>
          <form onSubmit={create} className="grid gap-4">
            <div className="grid max-h-[65vh] grid-cols-1 gap-4 overflow-y-auto sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="u-email">이메일 *</Label>
                <Input
                  id="u-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-name">이름</Label>
                <Input
                  id="u-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-pw">임시 비밀번호 * (8자 이상)</Label>
                <Input
                  id="u-pw"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-role">역할</Label>
                <select
                  id="u-role"
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm md:h-9"
                  value={role}
                  onChange={(e) => setRole(e.target.value as "member" | "admin")}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCreateOpen(false)}
              >
                취소
              </Button>
              <Button type="submit" disabled={busy || !email || !password}>
                <Plus className="size-4" />
                {busy ? "생성 중..." : "생성"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
