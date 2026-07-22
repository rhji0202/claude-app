/**
 * 에이전트 러너 - Claude Agent SDK의 query()를 감싸고,
 * 프로젝트/MCP/스킬 설정을 SDK 옵션으로 조립한다.
 */

import { store } from "@/lib/store";
import type { McpServer, Project } from "@/lib/types";

export interface RunResult {
  sessionId?: string;
  text: string;
  status: "ok" | "error";
  error?: string;
  /** 실행 중 발생한 원시 메시지(디버깅/로그용) */
  messages: unknown[];
}

/** MCP 서버 레코드를 SDK mcpServers 설정 형태로 변환 */
function toMcpConfig(server: McpServer): Record<string, unknown> {
  if (server.type === "stdio") {
    return {
      type: "stdio",
      command: server.command,
      args: server.args ?? [],
      env: server.env ?? {},
    };
  }
  // http / sse
  return {
    type: server.type,
    url: server.url,
  };
}

/** 프로젝트에 연결된 활성 MCP 서버들을 SDK 설정으로 모은다. */
async function resolveMcpServers(
  project: Project,
): Promise<Record<string, unknown>> {
  const ids = project.mcpServerIds ?? [];
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    const server = await store.get("mcpServers", id);
    if (server && server.enabled) {
      out[server.name] = toMcpConfig(server);
    }
  }
  return out;
}

/** 프로젝트에 연결된 활성 스킬을 시스템 프롬프트에 주입할 텍스트로 만든다. */
async function resolveSkillPrompt(project: Project): Promise<string> {
  const ids = project.skillIds ?? [];
  const parts: string[] = [];
  for (const id of ids) {
    const skill = await store.get("skills", id);
    if (skill && skill.enabled) {
      parts.push(`## 스킬: ${skill.name}\n${skill.description}\n\n${skill.content}`);
    }
  }
  if (parts.length === 0) return "";
  return `\n\n# 사용 가능한 스킬\n\n${parts.join("\n\n---\n\n")}`;
}

export interface RunOptions {
  prompt: string;
  project: Project;
  /** 이어서 진행할 세션 id */
  resume?: string;
  systemPrompt?: string;
  maxTurns?: number;
  onMessage?: (message: unknown) => void;
}

/**
 * 에이전트를 실행하고 최종 결과를 반환한다.
 *
 * SDK 패키지는 서버 런타임에서만 동적으로 로드한다(번들러 트레이싱 회피 +
 * 미설치 상태에서 앱 전체가 죽지 않도록).
 */
export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const { prompt, project, resume, maxTurns = 20, onMessage } = opts;

  let query: typeof import("@anthropic-ai/claude-agent-sdk").query;
  try {
    ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
  } catch (err) {
    return {
      status: "error",
      text: "",
      error:
        "Claude Agent SDK가 설치되지 않았습니다. `npm install`을 먼저 실행하세요. (" +
        String(err) +
        ")",
      messages: [],
    };
  }

  const mcpServers = await resolveMcpServers(project);
  const skillPrompt = await resolveSkillPrompt(project);
  const systemPrompt = [opts.systemPrompt, skillPrompt]
    .filter(Boolean)
    .join("\n");

  const messages: unknown[] = [];
  let sessionId: string | undefined;
  let text = "";

  try {
    const iterator = query({
      prompt,
      options: {
        cwd: project.cwd,
        model: project.model,
        maxTurns,
        // 뼈대 단계: 안전을 위해 기본 권한 모드 유지(신규 도구는 승인 필요).
        permissionMode: "default",
        allowedTools: project.allowedTools,
        mcpServers: mcpServers as never,
        systemPrompt: systemPrompt || undefined,
        resume,
        // 멀티테넌트 격리: 전역 설정 파일 로딩 안 함.
        settingSources: [],
      },
    });

    for await (const message of iterator) {
      messages.push(message);
      onMessage?.(message);

      const m = message as {
        type: string;
        subtype?: string;
        session_id?: string;
        result?: string;
        error?: string;
        message?: { content?: Array<{ type: string; text?: string }> };
      };

      if (m.type === "system" && m.subtype === "init" && m.session_id) {
        sessionId = m.session_id;
      }
      if (m.type === "assistant" && m.message?.content) {
        for (const block of m.message.content) {
          if (block.type === "text" && block.text) text += block.text;
        }
      }
      if (m.type === "result") {
        if (m.subtype === "success") {
          return {
            status: "ok",
            sessionId,
            text: m.result ?? text,
            messages,
          };
        }
        return {
          status: "error",
          sessionId,
          text,
          error: m.error ?? "실행 중 오류가 발생했습니다.",
          messages,
        };
      }
    }

    return { status: "ok", sessionId, text, messages };
  } catch (err) {
    return {
      status: "error",
      sessionId,
      text,
      error: String(err),
      messages,
    };
  }
}
