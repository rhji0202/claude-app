import { json, badRequest } from "@/lib/api";
import { store } from "@/lib/store";
import { importIssues } from "@/lib/modules/issues";
import { GitHubError } from "@/lib/github/client";

/**
 * 선택한 GitHub 이슈들을 작업 큐로 가져온다.
 *   POST /api/issues/import  { projectId, repo, numbers: number[] }
 */
export async function POST(req: Request) {
  let body: { projectId?: string; repo?: string; numbers?: number[] };
  try {
    body = await req.json();
  } catch {
    return badRequest("잘못된 JSON 본문입니다.");
  }
  if (!body.projectId) return badRequest("projectId는 필수입니다.");
  if (!body.repo) return badRequest("repo는 필수입니다.");
  if (!Array.isArray(body.numbers) || body.numbers.length === 0)
    return badRequest("가져올 이슈 번호(numbers)가 필요합니다.");

  const project = await store.get("projects", body.projectId);
  if (!project) return badRequest("프로젝트를 찾을 수 없습니다.");

  try {
    const created = await importIssues(body.projectId, body.repo, body.numbers);
    return json({ imported: created.length, tasks: created }, 201);
  } catch (err) {
    const status = err instanceof GitHubError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, status === 0 ? 500 : status);
  }
}
