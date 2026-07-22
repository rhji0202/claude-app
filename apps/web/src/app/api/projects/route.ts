import { listHandler, createHandler } from "@/lib/api";

export async function GET() {
  return listHandler("projects");
}

export async function POST(req: Request) {
  return createHandler("projects", req, (b) => {
    if (!b.name) return { ok: false, error: "name은 필수입니다." };
    if (!b.cwd) return { ok: false, error: "cwd(작업 디렉터리)는 필수입니다." };
    return { ok: true };
  });
}
