import { json, badRequest } from "@/lib/api";
import { listIssues, GitHubError } from "@/lib/github/client";

/**
 * GitHub에서 이슈 목록을 실시간 조회.
 *   GET /api/github/issues?repo=owner/repo&state=open
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repo = searchParams.get("repo");
  const state = (searchParams.get("state") ?? "open") as "open" | "closed" | "all";
  if (!repo) return badRequest("repo 쿼리 파라미터가 필요합니다. (owner/repo)");

  try {
    const issues = await listIssues(repo, { state });
    return json(issues);
  } catch (err) {
    const status = err instanceof GitHubError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, status === 0 ? 500 : status);
  }
}
