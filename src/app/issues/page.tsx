"use client";

import CrudPanel from "@/components/CrudPanel";

const STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  running: "실행 중",
  done: "완료",
  error: "오류",
};

export default function IssuesPage() {
  return (
    <div>
      <h1 className="page-title">GitHub 이슈</h1>
      <p className="page-desc">
        이슈를 작업 큐에 등록하고 에이전트로 실행합니다. 실행은 프로젝트 컨텍스트에서 이뤄집니다.
      </p>
      <CrudPanel
        endpoint="/api/issues"
        title="이슈 작업"
        columns={[
          { key: "repo", label: "저장소" },
          {
            key: "issueNumber",
            label: "#",
            render: (r) => `#${r.issueNumber}`,
          },
          { key: "title", label: "제목" },
          {
            key: "status",
            label: "상태",
            render: (r) => (
              <span className={`badge ${String(r.status)}`}>
                {STATUS_LABEL[String(r.status)] ?? String(r.status)}
              </span>
            ),
          },
        ]}
        fields={[
          {
            name: "projectId",
            label: "프로젝트",
            type: "select",
            required: true,
            optionsFrom: {
              endpoint: "/api/projects",
              valueKey: "id",
              labelKey: "name",
            },
          },
          { name: "repo", label: "저장소", required: true, placeholder: "owner/repo" },
          {
            name: "issueNumber",
            label: "이슈 번호",
            type: "number",
            required: true,
            placeholder: "42",
          },
          { name: "title", label: "제목", required: true, full: true },
          {
            name: "prompt",
            label: "추가 지시 (선택)",
            type: "textarea",
            placeholder: "특별히 지시할 내용이 있으면 입력",
          },
        ]}
        rowActions={[
          {
            label: "실행",
            href: (r) => `/api/issues/${r.id}/run`,
            confirm: "이 이슈 작업을 에이전트로 실행하시겠습니까?",
          },
        ]}
      />
    </div>
  );
}
