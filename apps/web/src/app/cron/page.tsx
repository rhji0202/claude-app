"use client";

import CrudPanel from "@/components/CrudPanel";

export default function CronPage() {
  return (
    <div>
      <h1 className="page-title">크론</h1>
      <p className="page-desc">
        정기적으로 에이전트 프롬프트를 실행합니다. 표준 5필드 크론식 (예:{" "}
        <span className="mono">0 9 * * 1</span> = 매주 월요일 9시).
      </p>
      <CrudPanel
        endpoint="/cron"
        title="크론 작업"
        columns={[
          { key: "name", label: "이름" },
          {
            key: "schedule",
            label: "스케줄",
            render: (r) => <span className="mono">{String(r.schedule)}</span>,
          },
          {
            key: "enabled",
            label: "활성",
            render: (r) =>
              r.enabled ? (
                <span className="badge ok">ON</span>
              ) : (
                <span className="badge queued">OFF</span>
              ),
          },
          {
            key: "lastStatus",
            label: "최근 실행",
            render: (r) =>
              r.lastStatus ? (
                <span className={`badge ${String(r.lastStatus)}`}>
                  {String(r.lastStatus)}
                </span>
              ) : (
                <span className="mono">—</span>
              ),
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
