/**
 * GitHub 이슈 처리 모듈.
 *
 * 이슈 작업을 큐에 넣고, 에이전트로 실행한 뒤 상태를 갱신한다.
 * (실제 GitHub API 연동은 MCP github 서버 또는 GITHUB_TOKEN을 통해 확장 가능)
 */

import { store } from "@/lib/store";
import { runAgent } from "@/lib/agent/runner";
import type { IssueTask } from "@/lib/types";

function defaultPrompt(task: IssueTask): string {
  return [
    `GitHub 저장소 ${task.repo}의 이슈 #${task.issueNumber} "${task.title}"를 처리해 주세요.`,
    ``,
    `단계:`,
    `1. 이슈 내용을 파악하고 관련 코드를 조사합니다.`,
    `2. 해결 방안을 구현합니다.`,
    `3. 변경 사항을 요약합니다.`,
    task.prompt ? `\n추가 지시:\n${task.prompt}` : ``,
  ].join("\n");
}

/** 이슈 작업을 에이전트로 실행한다. */
export async function runIssueTask(id: string): Promise<IssueTask | null> {
  const task = await store.get("issueTasks", id);
  if (!task) return null;

  const project = await store.get("projects", task.projectId);
  if (!project) {
    return store.update("issueTasks", id, {
      status: "error",
      error: "연결된 프로젝트를 찾을 수 없습니다.",
    });
  }

  await store.update("issueTasks", id, { status: "running", error: undefined });

  const result = await runAgent({
    prompt: defaultPrompt(task),
    project,
    resume: task.sessionId,
    systemPrompt:
      "당신은 GitHub 이슈를 해결하는 소프트웨어 엔지니어입니다. 신중하게 코드를 분석하고 최소한의 변경으로 문제를 해결하세요.",
  });

  return store.update("issueTasks", id, {
    status: result.status === "ok" ? "done" : "error",
    sessionId: result.sessionId ?? task.sessionId,
    result: result.text,
    error: result.error,
  });
}
