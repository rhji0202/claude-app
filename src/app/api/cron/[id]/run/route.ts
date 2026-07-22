import { json, notFound } from "@/lib/api";
import { runCronJob } from "@/lib/cron/scheduler";

type Ctx = { params: Promise<{ id: string }> };

// 크론 작업을 즉시 실행.
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const result = await runCronJob(id);
  return result ? json(result) : notFound("크론 작업을 찾을 수 없습니다.");
}
