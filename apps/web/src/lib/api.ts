/**
 * NestJS API 클라이언트. JWT 토큰을 localStorage에서 읽어 붙이고,
 * 에러 응답을 표준화한다.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

const TOKEN_KEY = "claude_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = opts;
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string>),
  };
  if (auth) {
    const token = getToken();
    if (token) h.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...rest, headers: h });
  if (!res.ok) {
    let message = `요청 실패 (${res.status})`;
    try {
      const data = await res.json();
      message = Array.isArray(data.message)
        ? data.message.join(", ")
        : data.message || data.error || message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, auth = true) => apiFetch<T>(path, { method: "GET", auth }),
  post: <T>(path: string, body?: unknown, auth = true) =>
    apiFetch<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
      auth,
    }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

/**
 * SSE 스트리밍 POST. 서버가 `data: <json>\n\n` 형식으로 흘려보내는 이벤트를
 * onEvent로 전달한다. EventSource는 Authorization 헤더를 못 실으므로 fetch+reader 사용.
 */
export async function streamPost(
  path: string,
  body: unknown,
  onEvent: (event: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) h.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `요청 실패 (${res.status})`;
    try {
      const data = await res.json();
      message = data.message || data.error || message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE 이벤트는 빈 줄(\n\n)로 구분
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      try {
        onEvent(JSON.parse(json));
      } catch {
        /* 파싱 불가한 조각 무시 */
      }
    }
  }
}
