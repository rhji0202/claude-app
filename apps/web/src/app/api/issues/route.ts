import { listHandler, createHandler } from "@/lib/api";

export async function GET() {
  return listHandler("issueTasks");
}

export async function POST(req: Request) {
  return createHandler("issueTasks", req, (b) => {
    if (!b.projectId) return { ok: false, error: "projectId는 필수입니다." };
    if (!b.repo) return { ok: false, error: "repo는 필수입니다. (owner/repo)" };
    if (b.issueNumber == null)
      return { ok: false, error: "issueNumber는 필수입니다." };
    if (!b.title) return { ok: false, error: "title은 필수입니다." };
    // 기본 상태 주입
    if (!b.status) b.status = "queued";
    return { ok: true };
  });
}
