"use client";

import Link from "next/link";
import CrudPanel from "@/components/CrudPanel";

export default function ProjectsPage() {
  return (
    <div>
      <h1 className="page-title">프로젝트</h1>
      <p className="page-desc">
        에이전트 실행 컨텍스트. 작업 디렉터리·모델·git 연결·API 키(프로젝트별, 암호화 저장)를 정의합니다.
        공유·스킬/MCP 연결은 각 프로젝트의 <strong>관리</strong>에서 설정합니다.
      </p>
      <CrudPanel
        endpoint="/projects"
        title="프로젝트"
        columns={[
          { key: "name", label: "이름" },
          { key: "gitRepo", label: "저장소" },
          {
            key: "visibility",
            label: "공개범위",
            render: (r) => <span className="badge queued">{String(r.visibility)}</span>,
          },
          {
            key: "secrets",
            label: "자격증명",
            render: (r) => {
              const s = r.secrets as { hasAnthropicApiKey: boolean; hasGitToken: boolean };
              return (
                <span className="mono">
                  {s?.hasAnthropicApiKey ? "🔑API " : ""}
                  {s?.hasGitToken ? "🔑git" : ""}
                  {!s?.hasAnthropicApiKey && !s?.hasGitToken ? "—" : ""}
                </span>
              );
            },
          },
          {
            key: "manage",
            label: "",
            render: (r) => (
              <Link href={`/projects/${r.id}`} style={{ color: "var(--accent)" }}>
                관리 →
              </Link>
            ),
          },
        ]}
        fields={[
          { name: "name", label: "이름", required: true, placeholder: "my-project" },
          {
            name: "cwd",
            label: "작업 디렉터리(cwd)",
            required: true,
            placeholder: "/home/user/projects/my-project",
            full: true,
          },
          { name: "gitRepo", label: "GitHub 저장소", placeholder: "owner/repo" },
          { name: "gitBranch", label: "브랜치", placeholder: "main" },
          {
            name: "gitToken",
            label: "GitHub 토큰 (암호화 저장)",
            placeholder: "ghp_...",
            full: true,
          },
          {
            name: "anthropicApiKey",
            label: "Anthropic API 키 (암호화 저장)",
            placeholder: "sk-ant-...",
            full: true,
          },
          { name: "model", label: "모델", placeholder: "claude-sonnet-5" },
          {
            name: "anthropicBaseUrl",
            label: "Anthropic Base URL (선택)",
            placeholder: "https://gateway.example.com",
          },
          {
            name: "allowedTools",
            label: "허용 도구 (콤마 구분)",
            type: "csv",
            placeholder: "Read, Write, Bash, mcp__github__*",
            full: true,
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
