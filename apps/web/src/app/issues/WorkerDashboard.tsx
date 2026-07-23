"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pause, Play, RotateCw } from "lucide-react";
import type { IssueWorkerStats } from "@claude-app/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const STATUS_META: {
  key: keyof IssueWorkerStats["counts"];
  label: string;
  color: string;
}[] = [
  { key: "queued", label: "대기", color: "text-muted-foreground" },
  { key: "running", label: "실행 중", color: "text-amber-500" },
  { key: "done", label: "완료", color: "text-emerald-500" },
  { key: "error", label: "오류", color: "text-destructive" },
  { key: "interrupted", label: "중단됨", color: "text-muted-foreground" },
];

/** ISO 시각 → "n분 전" 형태의 대략적 경과 표기 */
function since(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

/**
 * 워커 현황 대시보드(설계 7절). 이슈 페이지 상단 요약.
 * 상태별 카운트·슬롯 사용률·큐 적체/재시도 경고 + 운영 제어(일시정지·회수).
 * RUNNING/QUEUED가 남아 있는 동안 4초 폴링(이슈 목록과 동일 정책).
 */
export function WorkerDashboard() {
  const [stats, setStats] = useState<IssueWorkerStats | null>(null);
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    try {
      setStats(await api.get<IssueWorkerStats>("/issues/stats"));
    } catch {
      // 조용히 무시(다음 폴링에서 복구). 대시보드 실패로 페이지를 막지 않음.
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // RUNNING/QUEUED가 있을 때만 폴링(불필요한 요청 방지)
  const active = !!stats && (stats.counts.running > 0 || stats.counts.queued > 0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refetch(), 4000);
    return () => clearInterval(t);
  }, [active, refetch]);

  async function control(
    path: string,
    okMsg: string,
  ): Promise<void> {
    setBusy(true);
    try {
      await api.post(path);
      toast.success(okMsg);
      await refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!stats) return null;

  const { slots, counts, retrying, oldestQueuedAt, worker } = stats;
  const pct =
    slots.concurrency > 0
      ? Math.min(100, Math.round((slots.running / slots.concurrency) * 100))
      : 0;
  // 큐 적체 경고: 가장 오래된 대기 이슈가 5분 넘게 대기 중
  const stale =
    oldestQueuedAt && Date.now() - new Date(oldestQueuedAt).getTime() > 5 * 60000;

  return (
    <Card className="mb-5">
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 상태별 카운트 */}
          <div className="flex flex-wrap gap-4">
            {STATUS_META.map((s) => (
              <div key={s.key} className="text-center">
                <div className={`text-2xl font-semibold tabular-nums ${s.color}`}>
                  {counts[s.key]}
                </div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>

          {/* 운영 제어 */}
          <div className="flex items-center gap-2">
            {worker.paused ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => control("/issues/worker/resume", "워커를 재개했습니다.")}
              >
                <Play className="size-4" /> 재개
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => control("/issues/worker/pause", "워커를 일시정지했습니다.")}
              >
                <Pause className="size-4" /> 일시정지
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                control("/issues/worker/reclaim", "응답 없는 실행을 회수했습니다.")
              }
              title="응답 없는(stale) RUNNING 이슈를 중단으로 회수"
            >
              <RotateCw className="size-4" /> stale 회수
            </Button>
          </div>
        </div>

        {/* 슬롯 게이지 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              실행 슬롯 {slots.running} / {slots.concurrency}
              {slots.free > 0 && ` · 여유 ${slots.free}`}
            </span>
            {worker.paused && (
              <span className="font-medium text-amber-500">일시정지 중</span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-amber-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* 경고 배지 */}
        {(stale || retrying > 0) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {stale && oldestQueuedAt && (
              <span className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-600 dark:text-amber-400">
                큐 적체: 가장 오래된 대기 {since(oldestQueuedAt)}
              </span>
            )}
            {retrying > 0 && (
              <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
                재시도 대기 {retrying}건
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
