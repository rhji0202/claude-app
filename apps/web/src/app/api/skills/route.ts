import { listHandler, createHandler } from "@/lib/api";

export async function GET() {
  return listHandler("skills");
}

export async function POST(req: Request) {
  return createHandler("skills", req, (b) => {
    if (!b.name) return { ok: false, error: "name은 필수입니다." };
    if (!b.description) return { ok: false, error: "description은 필수입니다." };
    return { ok: true };
  });
}
