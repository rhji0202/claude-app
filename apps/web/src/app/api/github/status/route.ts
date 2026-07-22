import { json } from "@/lib/api";
import { isConfigured } from "@/lib/github/client";

// GITHUB_TOKEN 설정 여부 (UI가 안내 메시지를 띄우는 데 사용)
export async function GET() {
  return json({ configured: isConfigured() });
}
