import { listHandler, createHandler } from "@/lib/api";
import { validateSchedule } from "@/lib/cron/scheduler";

export async function GET() {
  return listHandler("cronJobs");
}

export async function POST(req: Request) {
  return createHandler("cronJobs", req, (b) => {
    if (!b.name) return { ok: false, error: "name은 필수입니다." };
    if (!b.schedule) return { ok: false, error: "schedule(크론식)은 필수입니다." };
    if (!b.prompt) return { ok: false, error: "prompt는 필수입니다." };
    if (!b.projectId) return { ok: false, error: "projectId는 필수입니다." };
    const v = validateSchedule(String(b.schedule));
    if (!v.ok) return { ok: false, error: `잘못된 크론식: ${v.error}` };
    if (b.enabled == null) b.enabled = true;
    return { ok: true };
  });
}
