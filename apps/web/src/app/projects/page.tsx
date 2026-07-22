"use client";

import CrudPanel from "@/components/CrudPanel";

export default function ProjectsPage() {
  return (
    <div>
      <h1 className="page-title">프로젝트</h1>
      <p className="page-desc">
        에이전트 실행 컨텍스트. 작업 디렉터리·모델·허용 도구·연결할 MCP/스킬을 정의합니다.
      </p>
      <CrudPanel
        endpoint="/api/projects"
        title="프로젝트"
        columns={[
          { key: "name", label: "이름" },
          { key: "repo", label: "저장소" },
          {
            key: "cwd",
            label: "작업 디렉터리",
            render: (r) => <span className="mono">{String(r.cwd ?? "")}</span>,
          },
          { key: "model", label: "모델" },
        ]}
        fields={[
          { name: "name", label: "이름", required: true, placeholder: "my-project" },
          { name: "repo", label: "GitHub 저장소", placeholder: "owner/repo" },
          {
            name: "cwd",
            label: "작업 디렉터리(cwd)",
            required: true,
            placeholder: "/home/user/projects/my-project",
            full: true,
          },
          { name: "model", label: "모델", placeholder: "claude-sonnet-5" },
          {
            name: "allowedTools",
            label: "허용 도구 (콤마 구분)",
            type: "csv",
            placeholder: "Read, Write, Bash, mcp__github__*",
            full: true,
          },
          {
            name: "mcpServerIds",
            label: "MCP 서버 id (콤마 구분)",
            type: "csv",
            placeholder: "MCP 페이지에서 id 확인 후 입력",
            full: true,
          },
          {
            name: "skillIds",
            label: "스킬 id (콤마 구분)",
            type: "csv",
            placeholder: "스킬 페이지에서 id 확인 후 입력",
            full: true,
          },
          { name: "description", label: "설명", type: "textarea" },
        ]}
      />
    </div>
  );
}
