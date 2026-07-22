/**
 * GitHub 이슈 처리 모듈.
 *
 * 이슈 작업을 큐에 넣고, 에이전트로 실행한 뒤 상태를 갱신한다.
 * 실행 시 GitHub에서 이슈 본문/코멘트를 (토큰이 있으면) 실시간으로 가져와
 * 프롬프트에 주입한다. 결과를 이슈에 코멘트로 되돌리는 것도 지원한다.
 */

import { store } from "@/lib/store";
import { runAgent } from "@/lib/agent/runner";
import * as github from "@/lib/github/client";
import type { IssueTask } from "@/lib/types";

/** GitHub에서 이슈 본문+코멘트를 가져와 에이전트 프롬프트를 구성한다. */
async function buildPrompt(task: IssueTask): Promise<string> {
  const lines: string[] = [
    `GitHub 저장소 ${task.repo}의 이슈 #${task.issueNumber} "${task.title}"를 해결해 주세요.`,
    ``,
  ];

  // 저장된 본문을 기본값으로, 토큰이 있으면 최신 내용으로 갱신
  let body = task.body ?? "";
  let comments: github.GitHubComment[] = [];
  if (github.isConfigured()) {
    try {
      const issue = await github.getIssue(task.repo, task.issueNumber);
      body = issue.body ?? body;
      comments = await github.listComments(task.repo, task.issueNumber);
    } catch {
      // GitHub 조회 실패 시 저장된 내용으로 진행
    }
  }

  if (task.labels && task.labels.length > 0) {
    lines.push(`라벨: ${task.labels.join(", ")}`, ``);
  }
  lines.push(`## 이슈 본문`, body || "(본문 없음)", ``);

  if (comments.length > 0) {
    lines.push(`## 코멘트 (${comments.length}개)`);
    for (const c of comments.slice(0, 10)) {
      lines.push(`- @${c.author ?? "unknown"}: ${c.body}`);
    }
    lines.push(``);
  }

  lines.push(
    `## 작업 지시`,
    `1. 이슈 내용을 파악하고 관련 코드를 조사합니다.`,
    `2. 최소한의 변경으로 문제를 해결합니다.`,
    `3. 변경한 파일과 이유를 요약합니다.`,
  );
  if (task.prompt) {
    lines.push(``, `## 추가 지시`, task.prompt);
  }
  return lines.join("\n");
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

  const prompt = await buildPrompt(task);
  const result = await runAgent({
    prompt,
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

/**
 * 이슈 작업의 실행 결과를 GitHub 이슈에 코멘트로 남긴다. (외부 쓰기 작업)
 * 호출 측(라우트)에서 사용자의 명시적 동작으로만 트리거해야 한다.
 */
export async function commentIssueResult(id: string): Promise<
  { ok: true; task: IssueTask } | { ok: false; error: string; status?: number }
> {
  const task = await store.get("issueTasks", id);
  if (!task) return { ok: false, error: "이슈 작업을 찾을 수 없습니다.", status: 404 };
  if (!github.isConfigured()) {
    return {
      ok: false,
      error: "GITHUB_TOKEN이 설정되지 않아 코멘트를 작성할 수 없습니다.",
      status: 400,
    };
  }
  if (!task.result) {
    return { ok: false, error: "먼저 이슈 작업을 실행해 결과를 만드세요.", status: 400 };
  }

  const body = [
    "🤖 **Claude 에이전트 실행 결과**",
    "",
    task.result,
  ].join("\n");

  try {
    const comment = await github.createComment(task.repo, task.issueNumber, body);
    const updated = await store.update("issueTasks", id, {
      resultCommentUrl: comment.html_url,
    });
    return { ok: true, task: updated! };
  } catch (err) {
    const status = err instanceof github.GitHubError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, status };
  }
}

/** GitHub 이슈들을 로컬 작업 큐로 가져온다. */
export async function importIssues(
  projectId: string,
  repo: string,
  numbers: number[],
): Promise<IssueTask[]> {
  const created: IssueTask[] = [];
  const existing = await store.list("issueTasks");

  for (const number of numbers) {
    // 같은 프로젝트+저장소+번호 중복 방지
    if (
      existing.some(
        (t) => t.projectId === projectId && t.repo === repo && t.issueNumber === number,
      )
    ) {
      continue;
    }
    const issue = await github.getIssue(repo, number);
    const task = await store.create("issueTasks", {
      projectId,
      repo,
      issueNumber: number,
      title: issue.title,
      body: issue.body ?? undefined,
      url: issue.html_url,
      labels: issue.labels,
      author: issue.author ?? undefined,
      status: "queued",
    });
    created.push(task);
  }
  return created;
}
