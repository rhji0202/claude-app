import { listHandler, createHandler } from "@/lib/api";

export async function GET() {
  return listHandler("mcpServers");
}

export async function POST(req: Request) {
  return createHandler("mcpServers", req, (b) => {
    if (!b.name) return { ok: false, error: "name은 필수입니다." };
    if (!b.type) return { ok: false, error: "type은 필수입니다. (stdio/http/sse)" };
    if (b.type === "stdio" && !b.command)
      return { ok: false, error: "stdio 타입은 command가 필요합니다." };
    if ((b.type === "http" || b.type === "sse") && !b.url)
      return { ok: false, error: "http/sse 타입은 url이 필요합니다." };
    return { ok: true };
  });
}
