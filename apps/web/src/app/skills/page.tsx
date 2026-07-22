"use client";

import CrudPanel from "@/components/CrudPanel";
import { PageHeader } from "@/components/PageHeader";
import { Mono } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";

export default function SkillsPage() {
  return (
    <div>
      <PageHeader title="스킬">
        재사용 가능한 지시/워크플로. 프로젝트에 연결하면 에이전트 시스템 프롬프트에 주입됩니다.
      </PageHeader>
      <CrudPanel
        endpoint="/skills"
        title="스킬"
        columns={[
          {
            key: "id",
            label: "id",
            render: (r) => <Mono>{String(r.id).slice(0, 8)}</Mono>,
          },
          { key: "name", label: "이름" },
          { key: "description", label: "설명" },
          { key: "scope", label: "범위" },
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
