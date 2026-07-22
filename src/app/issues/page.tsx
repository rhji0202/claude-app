"use client";

import { useState } from "react";
import CrudPanel from "@/components/CrudPanel";
import GithubImportPanel from "@/components/GithubImportPanel";

const STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  running: "실행 중",
  done: "완료",
  error: "오류",
};

export default function IssuesPage() {
  const [reload, setReload] = useState(0);

  return (
    <div>
      <h1 className="page-title">GitHub 이슈</h1>
      <p className="page-desc">
        GitHub에서 이슈를 실시간으로 불러와 큐에 등록하고, 에이전트로 실행한 뒤 결과를
        이슈 코멘트로 되돌릴 수 있습니다.
      </p>

      <GithubImportPanel onImported={() => setReload((r) => r + 1)} />

      <CrudPanel
        endpoint="/api/issues"
        title="이슈 작업"
        createTitle="이슈 작업 수동 추가"
        reloadSignal={reload}
        columns={[
          {
            key: "repo",
            label: "저장소",
            render: (r) =>
              r.url ? (
                <a href={String(r.url)} target="_blank" rel="noreferrer">
                  {String(r.repo)}
                </a>
              ) : (
                String(r.repo ?? "")
              ),
          },
          { key: "issueNumber", label: "#", render: (r) => `#${r.issueNumber}` },
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
          {
            key: "resultCommentUrl",
            label: "코멘트",
            render: (r) =>
              r.resultCommentUrl ? (
                <a href={String(r.resultCommentUrl)} target="_blank" rel="noreferrer">
                  게시됨 ↗
                </a>
              ) : (
                <span className="mono">—</span>
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
          {
            label: "결과 코멘트",
            href: (r) => `/api/issues/${r.id}/comment`,
            confirm:
              "실행 결과를 GitHub 이슈에 코멘트로 게시합니다. 진행하시겠습니까?",
          },
        ]}
      />
    </div>
  );
}
