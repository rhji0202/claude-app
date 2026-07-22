"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FolderGit2,
  CircleDot,
  Clock,
  Sparkles,
  Server,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const CARDS: {
  key: string;
  label: string;
  href: string;
  endpoint: string;
  icon: LucideIcon;
}[] = [
  { key: "projects", label: "프로젝트", href: "/projects", endpoint: "/projects", icon: FolderGit2 },
  { key: "issues", label: "이슈 작업", href: "/issues", endpoint: "/issues", icon: CircleDot },
  { key: "cron", label: "크론 작업", href: "/cron", endpoint: "/cron", icon: Clock },
  { key: "skills", label: "스킬", href: "/skills", endpoint: "/skills", icon: Sparkles },
  { key: "mcp", label: "MCP 서버", href: "/mcp", endpoint: "/mcp", icon: Server },
];

export default function Dashboard() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    (async () => {
      const next: Record<string, number> = {};
      await Promise.all(
        CARDS.map(async (c) => {
          try {
            const data = await api.get<unknown[]>(c.endpoint);
            next[c.key] = Array.isArray(data) ? data.length : 0;
          } catch {
            next[c.key] = 0;
          }
        }),
      );
      setCounts(next);
    })();
  }, []);

  return (
    <div>
      <PageHeader title="대시보드">
        Claude Agent SDK 기반 관리 시스템 — 이슈 처리, 크론, 프로젝트, 스킬, MCP를 한 곳에서.
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.key} href={c.href} className="group">
              <Card className="h-full transition-colors group-hover:border-accent/50">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <Icon className="size-5 text-muted-foreground transition-colors group-hover:text-accent" />
                    <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <div className="mt-3 text-3xl font-bold tabular-nums">
                    {counts ? (
                      counts[c.key]
                    ) : (
                      <Skeleton className="h-8 w-10" />
                    )}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {c.label}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardContent className="p-5">
          <h2 className="mb-3 text-sm font-semibold">시작하기</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>
              <strong className="text-foreground">프로젝트</strong>를 만드세요 (작업 디렉터리, 모델, git 저장소·토큰, Anthropic API 키).
            </li>
            <li>
              프로젝트 <strong className="text-foreground">관리</strong>에서 팀원 공유·공유 링크 발급, 스킬·MCP 연결을 설정하세요.
            </li>
            <li>
              <strong className="text-foreground">이슈</strong>를 GitHub에서 가져오거나 수동 등록해 실행하고, <strong className="text-foreground">크론</strong>으로 정기 작업을 예약하세요.
            </li>
            <li>
              <strong className="text-foreground">공유 링크</strong>(issue_report)를 발급하면 테스터가 로그인 없이 이슈를 등록할 수 있습니다.
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
