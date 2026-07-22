import { json, badRequest, notFound } from "@/lib/api";
import { store } from "@/lib/store";
import { runAgent } from "@/lib/agent/runner";

/**
 * 임의 프롬프트로 에이전트를 실행한다. (프로젝트 컨텍스트 사용)
 * body: { projectId: string, prompt: string, resume?: string }
 */
export async function POST(req: Request) {
  let body: { projectId?: string; prompt?: string; resume?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest("잘못된 JSON 본문입니다.");
  }
  if (!body.projectId) return badRequest("projectId는 필수입니다.");
  if (!body.prompt) return badRequest("prompt는 필수입니다.");

  const project = await store.get("projects", body.projectId);
  if (!project) return notFound("프로젝트를 찾을 수 없습니다.");

  const result = await runAgent({
    prompt: body.prompt,
    project,
    resume: body.resume,
  });

  return json(result);
}
