"use client";

import Link from "next/link";
import { KeyRound } from "lucide-react";
import CrudPanel from "@/components/CrudPanel";
import { PageHeader } from "@/components/PageHeader";
import { Mono } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";

export default function ProjectsPage() {
  return (
    <div>
      <PageHeader title="프로젝트">
        에이전트 실행 컨텍스트. 작업 디렉터리·git 연결을 정의합니다. Anthropic
        자격증명은 <strong>계정</strong>에서, 공유·스킬/MCP 연결은 각 프로젝트의{" "}
        <strong>관리</strong>에서 설정합니다.
      </PageHeader>
      <CrudPanel
        endpoint="/projects"
        title="프로젝트"
        columns={[
          { key: "name", label: "이름" },
          {
            key: "gitRepo",
            label: "저장소",
            render: (r) => <Mono>{String(r.gitRepo ?? "—")}</Mono>,
          },
          {
            key: "visibility",
            label: "공개범위",
            render: (r) => <Badge variant="muted">{String(r.visibility)}</Badge>,
          },
          {
            key: "secrets",
            label: "자격증명",
            render: (r) => {
              const s = r.secrets as { hasGitToken: boolean };
              if (!s?.hasGitToken) return <Mono>—</Mono>;
              return (
                <Badge variant="outline">
                  <KeyRound className="size-3" />
                  git
                </Badge>
              );
            },
          },
          {
            key: "manage",
            label: "",
            render: (r) => (
              <Link
                href={`/projects/${r.id}`}
                className="font-medium text-accent hover:underline"
              >
                관리 →
              </Link>
            ),
          },
        ]}
        fields={[
          { name: "name", label: "이름", required: true, placeholder: "my-project" },
          {
            name: "gitRepo",
            label: "GitHub 저장소 (실행에 필요)",
            placeholder: "owner/repo",
            full: true,
          },
          { name: "gitBranch", label: "브랜치", placeholder: "main" },
          {
            name: "gitToken",
            label: "GitHub 토큰 (암호화 저장)",
            placeholder: "ghp_...",
            full: true,
          },
          {
            name: "claudeAccountId",
            label: "Claude 계정 (미선택 시 기본 활성 계정)",
            type: "select",
            optionsFrom: {
              endpoint: "/claude-accounts",
              valueKey: "id",
              labelKey: "label",
            },
          },
          {
            name: "visibility",
            label: "공개 범위",
            type: "select",
            defaultValue: "private",
            options: [
              { value: "private", label: "비공개" },
              { value: "shared", label: "공유" },
              { value: "public", label: "공개" },
            ],
          },
          { name: "description", label: "설명", type: "textarea" },
        ]}
      />
    </div>
  );
}
