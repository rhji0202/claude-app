import { json } from "@/lib/api";
import { commentIssueResult } from "@/lib/modules/issues";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 이슈 작업의 실행 결과를 GitHub 이슈에 코멘트로 남긴다. (외부 쓰기 작업)
 *   POST /api/issues/:id/comment
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const result = await commentIssueResult(id);
  if (result.ok) return json(result.task);
  return json({ error: result.error }, result.status ?? 500);
}
