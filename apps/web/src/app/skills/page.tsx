"use client";

import CrudPanel from "@/components/CrudPanel";

export default function SkillsPage() {
  return (
    <div>
      <h1 className="page-title">스킬</h1>
      <p className="page-desc">
        재사용 가능한 지시/워크플로. 프로젝트에 연결하면 에이전트 시스템 프롬프트에 주입됩니다.
      </p>
      <CrudPanel
        endpoint="/skills"
        title="스킬"
        columns={[
          {
            key: "id",
            label: "id",
            render: (r) => <span className="mono">{String(r.id).slice(0, 8)}</span>,
          },
          { key: "name", label: "이름" },
          { key: "description", label: "설명" },
          { key: "scope", label: "범위" },
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
        ]}
        fields={[
          { name: "name", label: "이름", required: true, placeholder: "code-review" },
          {
            name: "scope",
            label: "범위",
            type: "select",
            defaultValue: "global",
            options: [
              { value: "global", label: "전역" },
              { value: "project", label: "프로젝트" },
            ],
          },
          {
            name: "description",
            label: "설명",
            required: true,
            full: true,
            placeholder: "언제 이 스킬을 쓰는지",
          },
          {
            name: "content",
            label: "본문 (SKILL.md 마크다운)",
            type: "textarea",
            placeholder: "# 단계\n1. ...",
          },
          { name: "enabled", label: "활성화", type: "checkbox", defaultValue: true },
        ]}
      />
    </div>
  );
}
