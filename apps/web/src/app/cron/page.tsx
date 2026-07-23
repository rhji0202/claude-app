"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { CronRun } from "@claude-app/shared";
import CrudPanel from "@/components/CrudPanel";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, Mono } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** 다음 실행 예정 시각을 상대적으로 읽기 쉽게 포맷. */
function fmtNext(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diff = t - Date.now();
  if (diff <= 0) return "곧";
  const min = Math.round(diff / 60000);
  if (min < 60) return `${min}분 후`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}시간 후`;
  return `${Math.round(hr / 24)}일 후`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * "최근 실행" 배지를 클릭하면 마지막 결과 + 실행 이력(최근 50건)을 다이얼로그로 보여준다.
 * 이력은 열 때 GET /cron/:id/runs로 지연 로드.
 */
function CronRunCell({ row }: { row: Record<string, unknown> }) {
  const id = String(row.id);
  const lastStatus = row.lastStatus as string | null | undefined;
  const lastResult = (row.lastResult as string | null | undefined) ?? null;
  const [runs, setRuns] = useState<CronRun[] | null>(null);
  const [loading, setLoading] = useState(false);

  const badge = lastStatus ? (
    <StatusBadge status={String(lastStatus)} />
  ) : (
    <Mono>—</Mono>
  );

  // 실행 이력이 없고 표시할 결과도 없으면 배지만(클릭 불가)
  if (!lastStatus && !lastResult) return badge;

  async function loadRuns(open: boolean) {
    if (!open || runs || loading) return;
    setLoading(true);
    try {
      setRuns(await api.get<CronRun[]>(`/cron/${id}/runs`));
    } catch (e) {
      toast.error((e as Error).message);
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog onOpenChange={loadRuns}>
      <DialogTrigger className="cursor-pointer" title="실행 이력 보기">
        {badge}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>실행 이력</DialogTitle>
          <DialogDescription>{String(row.name ?? "")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {loading && (
            <p className="text-sm text-muted-foreground">불러오는 중…</p>
          )}
          {runs && runs.length === 0 && (
            <p className="text-sm text-muted-foreground">실행 이력이 없습니다.</p>
          )}
          {runs?.map((run) => (
            <div
              key={run.id}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {run.status ? (
                  <StatusBadge status={run.status} />
                ) : (
                  <Badge variant="muted">실행 중</Badge>
                )}
                <span>{new Date(run.startedAt).toLocaleString()}</span>
                <span>· {fmtDuration(run.durationMs)}</span>
              </div>
              {(run.result || run.error) && (
                <pre
                  className={`mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs ${
                    run.error ? "text-destructive" : ""
                  }`}
                >
                  {run.error ?? run.result}
                </pre>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CronPage() {
  return (
    <div>
      <PageHeader title="크론">
        정기적으로 에이전트 프롬프트를 실행합니다. 표준 5필드 크론식 (예:{" "}
        <Mono>0 9 * * 1</Mono> = 매주 월요일 9시).
      </PageHeader>
      <CrudPanel
        endpoint="/cron"
        title="크론 작업"
        editableFields={["name", "schedule", "prompt", "enabled"]}
        pollWhile={(rows) => rows.some((r) => r.lastStatus == null && r.enabled)}
        pollMs={5000}
        columns={[
          { key: "name", label: "이름" },
          {
            key: "schedule",
            label: "스케줄",
            render: (r) => <Mono>{String(r.schedule)}</Mono>,
          },
          {
            key: "enabled",
            label: "활성",
            render: (r) =>
              r.enabled ? (
                <Badge variant="success">ON</Badge>
              ) : (
                <Badge variant="muted">OFF</Badge>
              ),
          },
          {
            key: "nextRunAt",
            label: "다음 실행",
            render: (r) => (
              <Mono>{fmtNext(r.nextRunAt as string | null | undefined)}</Mono>
            ),
          },
          {
            key: "lastStatus",
            label: "최근 실행",
            render: (r) => <CronRunCell row={r} />,
          },
        ]}
        fields={[
          { name: "name", label: "이름", required: true, placeholder: "daily-report" },
          {
            name: "projectId",
            label: "프로젝트",
            type: "select",
            required: true,
            optionsFrom: { endpoint: "/projects", valueKey: "id", labelKey: "name" },
          },
          { name: "schedule", label: "크론식", required: true, placeholder: "0 9 * * 1" },
          { name: "enabled", label: "활성화", type: "checkbox", defaultValue: true },
          {
            name: "prompt",
            label: "프롬프트",
            type: "textarea",
            required: true,
            placeholder: "이 프로젝트의 테스트를 실행하고 실패를 요약해줘",
          },
        ]}
        rowActions={[
          {
            label: "지금 실행",
            href: (r) => `/cron/${r.id}/run`,
            confirm: "이 크론 작업을 지금 실행하시겠습니까?",
          },
        ]}
      />
    </div>
  );
}
