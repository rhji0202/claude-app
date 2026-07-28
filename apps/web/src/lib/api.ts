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
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

/**
 * 멀티파트 업로드. FormData를 그대로 보낸다(Content-Type은 브라우저가 boundary와 함께 설정).
 * auth=true면 Bearer 토큰 부착.
 */
export async function upload<T = unknown>(
  path: string,
  form: FormData,
  auth = true,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    let message = `업로드 실패 (${res.status})`;
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

/** 업로드된 이미지 상대경로 → 정적 서빙 절대 URL (API_BASE에서 /api 떼고 /uploads) */
export function uploadUrl(relPath: string): string {
  const origin = API_BASE.replace(/\/api\/?$/, "");
  return `${origin}/uploads/${relPath}`;
}

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

  await readSseStream(res.body, onEvent);
}

/**
 * SSE 스트리밍 GET. 장기 연결로 서버가 흘려보내는 이벤트를 onEvent로 전달한다.
 * signal.abort()로 연결을 종료한다(폴링 대체 구독용). EventSource 대신 fetch+reader —
 * Authorization 헤더를 실을 수 있고 종료 제어가 명확하다.
 */
export async function streamGet(
  path: string,
  onEvent: (event: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const h: Record<string, string> = {};
  const token = getToken();
  if (token) h.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { headers: h, signal });
  if (!res.ok || !res.body) throw new ApiError(res.status, `스트림 실패 (${res.status})`);
  await readSseStream(res.body, onEvent);
}

/** `data: <json>\n\n` 형식 SSE 본문을 파싱해 이벤트마다 onEvent 호출. */
async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
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
