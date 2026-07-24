"use client";

import { useEffect, useMemo, useState } from "react";
import { DollarSign, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UsageSummary, UsageGroupBy, UsageSummaryRow } from "@claude-app/shared";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const usd = (n: number) =>
  n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(n >= 0.01 ? 3 : 4)}`;
const compact = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}K`
      : String(n);

/** groupBy 탭. day는 시계열 차트, 나머지는 breakdown 막대. */
const TABS: { key: UsageGroupBy; label: string }[] = [
  { key: "day", label: "일별" },
  { key: "project", label: "프로젝트" },
  { key: "account", label: "계정" },
  { key: "model", label: "모델" },
  { key: "kind", label: "종류" },
];

const KIND_LABEL: Record<string, string> = {
  issue: "이슈",
  cron: "크론",
  chat: "채팅",
};

// 차트 색상은 테마 accent 토큰을 따른다(라이트/다크 자동).
const BAR_COLOR = "var(--accent)";

/** 막대 hover 시 표시할 커스텀 툴팁(비용·토큰·실행수). */
function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
}) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-foreground">{r.name}</div>
      <div className="tabular-nums text-accent">{usd(r.costUsd)}</div>
      <div className="tabular-nums text-muted-foreground">
        입력 {compact(r.inputTokens)} · 출력 {compact(r.outputTokens)}
      </div>
      <div className="tabular-nums text-muted-foreground">{r.count}회 실행</div>
    </div>
  );
}

interface ChartRow {
  name: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  count: number;
}

function toChartRows(data: UsageSummary): ChartRow[] {
  const labelOf = (r: UsageSummaryRow): string => {
    if (data.groupBy === "day") return r.key.slice(5); // MM-DD
    if (data.groupBy === "kind") return KIND_LABEL[r.key] ?? r.key;
    return r.label ?? r.key;
  };
  return data.rows.map((r) => ({
    name: labelOf(r),
    costUsd: Number(r.costUsd.toFixed(4)),
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    count: r.count,
  }));
}

/**
 * 사용량(비용·토큰) 대시보드 패널. GET /usage/summary를 groupBy별로 조회해
 * 총액 카드 + Recharts 막대(일별 시계열 / breakdown)를 렌더한다.
 */
export function UsagePanel() {
  const [groupBy, setGroupBy] = useState<UsageGroupBy>("day");
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<UsageSummary>(`/usage/summary?groupBy=${groupBy}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupBy]);

  const rows = useMemo(() => (data ? toChartRows(data) : []), [data]);
  const isDay = groupBy === "day";

  return (
    <Card className="mt-6">
      <CardContent className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-accent" />
            <h2 className="text-sm font-semibold">사용량 · 비용</h2>
          </div>
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setGroupBy(t.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition-colors",
                  groupBy === t.key
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : !data || rows.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
            <DollarSign className="size-6 opacity-40" />
            아직 기록된 사용량이 없습니다.
          </div>
        ) : (
          <>
            {/* 총계 요약 */}
            <div className="mb-4 flex flex-wrap gap-6">
              <Stat label="총 예상 비용" value={usd(data.total.costUsd)} accent />
              <Stat label="입력 토큰" value={compact(data.total.inputTokens)} />
              <Stat label="출력 토큰" value={compact(data.total.outputTokens)} />
              <Stat label="실행 수" value={String(data.total.count)} />
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={rows}
                  layout={isDay ? "horizontal" : "vertical"}
                  margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
                >
                  {isDay ? (
                    <>
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        tickFormatter={(v: number) => usd(v)}
                      />
                    </>
                  ) : (
                    <>
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => usd(v)}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        width={110}
                      />
                    </>
                  )}
                  <Tooltip
                    content={<ChartTooltip />}
                    cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  />
                  <Bar dataKey="costUsd" radius={isDay ? [3, 3, 0, 0] : [0, 3, 3, 0]}>
                    {rows.map((_, i) => (
                      <Cell key={i} fill={BAR_COLOR} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          비용은 SDK가 보고하는 예상치입니다. 정액 구독(OAuth) 계정은 실제 청구액과 다를 수 있습니다.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className={cn("text-2xl font-bold tabular-nums", accent && "text-accent")}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
