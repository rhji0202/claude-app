import { json, notFound } from "@/lib/api";
import { runIssueTask } from "@/lib/modules/issues";

type Ctx = { params: Promise<{ id: string }> };

// 이슈 작업을 에이전트로 실행 (동기 실행 후 결과 반환).
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const result = await runIssueTask(id);
  return result ? json(result) : notFound("이슈 작업을 찾을 수 없습니다.");
}
