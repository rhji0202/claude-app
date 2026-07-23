import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import pLimit from "p-limit";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";
import { ClaudeAccountService } from "../claude-account/claude-account.service";

export interface AgentImage {
  /** base64 인코딩 이미지 데이터 */
  data: string;
  /** image/png | image/jpeg | image/gif | image/webp */
  mediaType: string;
}

export interface RunAgentOptions {
  prompt: string;
  resume?: string;
  systemPrompt?: string;
  maxTurns?: number;
  /** 실행 자격증명(활성 Claude 계정)을 소유한 사용자. 없으면 .env 폴백. */
  userId?: string;
  /** 첨부 이미지 — 있으면 멀티모달 프롬프트(image content block)로 전달 */
  images?: AgentImage[];
  /**
   * 실행 작업 디렉터리(절대경로). 이슈/크론은 관리 clone→worktree 경로를 주입한다.
   * (설계 12.5) project.cwd는 더 이상 실행 근거가 아니며, 반드시 이 값을 지정해야 한다.
   */
  cwd: string;
}

export interface RunResult {
  status: "ok" | "error";
  sessionId?: string;
  text: string;
  error?: string;
  /**
   * 결과를 받기 전에 실행이 중단됨(프로세스 kill·서버 종료 등).
   * 진짜 오류가 아니므로 호출측에서 '중단' 상태로 구분한다.
   */
  interrupted?: boolean;
}

/**
 * 스트리밍 실행 중 방출되는 이벤트. claude.ai식 parts 타임라인 모델.
 * 텍스트 세그먼트는 id로 식별 — delta는 누적, text_end는 확정(교체). 중복 방지.
 */
export type AgentStreamEvent =
  | { type: "session"; sessionId: string }
  | { type: "text_start"; id: string }
  | { type: "text_delta"; id: string; delta: string }
  | { type: "text_end"; id: string; text: string }
  | { type: "tool"; id: string; name: string; input?: string }
  | { type: "done"; text: string; sessionId?: string }
  | { type: "error"; error: string; sessionId?: string };

export interface RunStreamOptions extends RunAgentOptions {}

/**
 * 에이전트 실행 서비스. Claude Agent SDK의 query()를 감싸고,
 * 프로젝트별 자격증명(복호화)·MCP·스킬을 SDK 옵션으로 조립한다.
 *
 * 에이전트 1회 실행 = Claude Code CLI 서브프로세스 1개이므로 p-limit으로
 * 동시 실행 수를 제한한다.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly claudeAccounts: ClaudeAccountService,
  ) {
    const concurrency = this.config.get<number>("AGENT_CONCURRENCY") ?? 3;
    this.limit = pLimit(concurrency);
  }

  /**
   * SDK 서브프로세스로 전달할 env 조립.
   * - Anthropic 자격증명 우선순위: 프로젝트 지정 계정 → 실행 사용자 활성 계정 → .env 폴백.
   * - git 토큰: 프로젝트 gitToken → GITHUB_TOKEN/GH_TOKEN.
   */
  private async buildEnv(
    userId: string | undefined,
    gitToken: string | null,
    claudeAccountId?: string | null,
  ): Promise<Record<string, string | undefined>> {
    const env: Record<string, string | undefined> = { ...process.env };

    const token =
      (claudeAccountId
        ? await this.claudeAccounts.getTokenById(claudeAccountId)
        : null) ??
      (userId ? await this.claudeAccounts.getActiveToken(userId) : null) ??
      this.config.get<string>("ANTHROPIC_OAUTH_TOKEN") ??
      null;

    // 값이 없거나 어느 쪽이든, 두 자격증명이 동시에 있으면 CLI가 혼동하므로 정리한다.
    delete env.ANTHROPIC_API_KEY;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    if (token) {
      // sk-ant-oat…은 OAuth 토큰(구독/CLI 로그인) → OAuth 경로. 그 외는 API 키.
      if (token.startsWith("sk-ant-oat")) env.CLAUDE_CODE_OAUTH_TOKEN = token;
      else env.ANTHROPIC_API_KEY = token;
    }

    if (gitToken) {
      env.GITHUB_TOKEN = gitToken;
      env.GH_TOKEN = gitToken;
    }
    return env;
  }

  /** 프로젝트에 연결된 활성 MCP 서버를 SDK mcpServers 설정으로 변환 */
  private async resolveMcpServers(
    projectId: string,
  ): Promise<Record<string, unknown>> {
    const links = await this.prisma.projectMcpServer.findMany({
      where: { projectId },
      include: { server: true },
    });
    const out: Record<string, unknown> = {};
    for (const { server } of links) {
      if (!server.enabled) continue;
      if (server.type === "STDIO") {
        out[server.name] = {
          type: "stdio",
          command: server.command,
          args: server.args,
          env: (server.env as Record<string, string> | null) ?? {},
        };
      } else {
        out[server.name] = {
          type: server.type.toLowerCase(),
          url: server.url,
        };
      }
    }
    return out;
  }

  /** 프로젝트에 연결된 활성 스킬을 시스템 프롬프트로 결합 */
  private async resolveSkillPrompt(projectId: string): Promise<string> {
    const links = await this.prisma.projectSkill.findMany({
      where: { projectId },
      include: { skill: true },
    });
    const parts = links
      .map((l) => l.skill)
      .filter((s) => s.enabled)
      .map((s) => `## 스킬: ${s.name}\n${s.description}\n\n${s.content}`);
    if (parts.length === 0) return "";
    return `\n\n# 사용 가능한 스킬\n\n${parts.join("\n\n---\n\n")}`;
  }

  /**
   * 프로젝트 컨텍스트로 에이전트를 실행한다. (동시성 제한 적용)
   */
  async run(projectId: string, opts: RunAgentOptions): Promise<RunResult> {
    return this.limit(() => this.execute(projectId, opts));
  }

  /**
   * 스트리밍 실행. 토큰 델타(delta)·세션·완료/오류를 onEvent로 방출한다.
   * 채팅 UI(SSE)에서 사용. 동시성 제한은 run과 공유.
   */
  async runStream(
    projectId: string,
    opts: RunStreamOptions,
    onEvent: (e: AgentStreamEvent) => void,
  ): Promise<void> {
    return this.limit(() => this.executeStream(projectId, opts, onEvent));
  }

  private async executeStream(
    projectId: string,
    opts: RunStreamOptions,
    onEvent: (e: AgentStreamEvent) => void,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      onEvent({ type: "error", error: "프로젝트를 찾을 수 없습니다." });
      return;
    }

    let query: typeof import("@anthropic-ai/claude-agent-sdk").query;
    try {
      ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
    } catch (err) {
      onEvent({ type: "error", error: `SDK 로드 실패: ${String(err)}` });
      return;
    }

    const gitToken = this.crypto.decryptOptional(project.gitTokenEnc);
    const mcpServers = await this.resolveMcpServers(projectId);
    const skillPrompt = await this.resolveSkillPrompt(projectId);
    const systemPrompt = [opts.systemPrompt, skillPrompt]
      .filter(Boolean)
      .join("\n");
    const env = await this.buildEnv(
      opts.userId,
      gitToken,
      project.claudeAccountId,
    );

    let sessionId: string | undefined;
    let finalText = "";
    // 턴 경계 카운터 — 텍스트 세그먼트 id를 `${turn}:${blockIndex}`로 만든다.
    let turn = 0;
    // content_block_start로 열린 텍스트 블록의 id (index → true). text_start 중복 방지.
    const openedText = new Set<string>();

    const segId = (index: number) => `${turn}:${index}`;

    try {
      const iterator = query({
        prompt: opts.prompt,
        options: {
          // 실행 디렉터리는 항상 호출측이 주입한 worktree 경로(설계 12.5). project.cwd 미사용.
          cwd: opts.cwd,
          maxTurns: opts.maxTurns ?? 20,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          mcpServers: mcpServers as never,
          systemPrompt: systemPrompt || undefined,
          resume: opts.resume,
          settingSources: [],
          env,
        },
      });

      for await (const message of iterator) {
        const m = message as {
          type: string;
          subtype?: string;
          session_id?: string;
          result?: string;
          error?: string;
          num_turns?: number;
          event?: {
            type?: string;
            index?: number;
            content_block?: { type?: string };
            delta?: { type?: string; text?: string };
          };
          message?: {
            content?: Array<{
              type: string;
              text?: string;
              id?: string;
              name?: string;
              input?: unknown;
            }>;
          };
        };

        if (m.type === "system" && m.subtype === "init" && m.session_id) {
          sessionId = m.session_id;
          onEvent({ type: "session", sessionId });
        }

        if (m.type === "stream_event" && m.event) {
          const ev = m.event;
          if (ev.type === "message_start") {
            turn += 1;
          } else if (
            ev.type === "content_block_start" &&
            ev.content_block?.type === "text" &&
            typeof ev.index === "number"
          ) {
            const id = segId(ev.index);
            openedText.add(id);
            onEvent({ type: "text_start", id });
          } else if (
            ev.type === "content_block_delta" &&
            ev.delta?.type === "text_delta" &&
            ev.delta.text &&
            typeof ev.index === "number"
          ) {
            onEvent({ type: "text_delta", id: segId(ev.index), delta: ev.delta.text });
          }
        }

        // 완결된 assistant 턴 — 텍스트 블록 확정(text_end) + tool_use 블록
        if (m.type === "assistant" && m.message?.content) {
          m.message.content.forEach((block, index) => {
            if (block.type === "text" && block.text) {
              const id = segId(index);
              // 델타가 없었던(스트리밍 안 된) 텍스트면 start도 보내 프론트가 파트를 만들게 함
              if (!openedText.has(id)) onEvent({ type: "text_start", id });
              onEvent({ type: "text_end", id, text: block.text });
            } else if (block.type === "tool_use" && block.name) {
              let input: string | undefined;
              try {
                input = block.input ? JSON.stringify(block.input) : undefined;
              } catch {
                input = undefined;
              }
              onEvent({
                type: "tool",
                id: block.id ?? segId(index),
                name: block.name,
                input,
              });
            }
          });
        }

        if (m.type === "result") {
          if (m.subtype === "success") {
            onEvent({ type: "done", text: m.result ?? finalText, sessionId });
          } else {
            onEvent({
              type: "error",
              error: this.describeResultError(m),
              sessionId,
            });
          }
          return;
        }
      }
      // result 없이 스트림 종료 = 결과 전에 실행이 중단됨. 성공으로 오인 금지.
      onEvent({
        type: "error",
        error: "에이전트가 결과를 반환하기 전에 실행이 중단되었습니다.",
        sessionId,
      });
    } catch (err) {
      this.logger.error(`스트리밍 실행 오류: ${String(err)}`);
      onEvent({ type: "error", error: String(err), sessionId });
    }
  }

  /**
   * SDK result 메시지(비성공)에서 사람이 읽을 오류 문구를 만든다.
   * SDK는 종료 사유를 subtype으로 준다(error_max_turns 등). 명시 error가 없을 때
   * 무의미한 폴백 대신 subtype·턴 수를 남겨 원인 추적이 가능하게 한다.
   */
  private describeResultError(m: {
    subtype?: string;
    error?: string;
    num_turns?: number;
  }): string {
    if (m.error) return m.error;
    const reason =
      m.subtype === "error_max_turns"
        ? `최대 턴 수(${m.num_turns ?? "?"}턴)에 도달해 중단되었습니다.`
        : m.subtype === "error_during_execution"
          ? "실행 중 오류가 발생했습니다."
          : `실행이 비정상 종료되었습니다 (${m.subtype ?? "unknown"}).`;
    return reason;
  }

  private async execute(
    projectId: string,
    opts: RunAgentOptions,
  ): Promise<RunResult> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException("프로젝트를 찾을 수 없습니다.");

    // SDK는 런타임에서만 동적 로드 (번들러 트레이싱 회피 + 미설치 시 graceful)
    let query: typeof import("@anthropic-ai/claude-agent-sdk").query;
    try {
      ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
    } catch (err) {
      return {
        status: "error",
        text: "",
        error: `Claude Agent SDK 로드 실패: ${String(err)}`,
      };
    }

    const gitToken = this.crypto.decryptOptional(project.gitTokenEnc);

    const mcpServers = await this.resolveMcpServers(projectId);
    const skillPrompt = await this.resolveSkillPrompt(projectId);
    const systemPrompt = [opts.systemPrompt, skillPrompt]
      .filter(Boolean)
      .join("\n");

    const env = await this.buildEnv(
      opts.userId,
      gitToken,
      project.claudeAccountId,
    );

    const messages: unknown[] = [];
    let sessionId: string | undefined;
    let text = "";

    // 이미지가 있으면 멀티모달 프롬프트(AsyncIterable + image content block).
    // AsyncIterable 프롬프트와 resume 병행은 불안정하므로 이미지 실행은 새 세션으로.
    const hasImages = (opts.images?.length ?? 0) > 0;
    const promptInput = hasImages
      ? (async function* () {
          yield {
            type: "user" as const,
            session_id: "",
            parent_tool_use_id: null,
            message: {
              role: "user" as const,
              content: [
                { type: "text" as const, text: opts.prompt },
                ...opts.images!.map((im) => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: im.mediaType,
                    data: im.data,
                  },
                })),
              ],
            },
          };
        })()
      : opts.prompt;

    try {
      const iterator = query({
        prompt: promptInput as never,
        options: {
          // 실행 디렉터리는 항상 호출측이 주입한 worktree 경로(설계 12.5). project.cwd 미사용.
          cwd: opts.cwd,
          maxTurns: opts.maxTurns ?? 20,
          // 전체 bypass 실행. 헤드리스 서버 컨텍스트라 권한 프롬프트가 불가능하므로
          // 모든 도구(bash 포함)를 무프롬프트로 실행한다. bypass에는 이 플래그가 필요.
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          mcpServers: mcpServers as never,
          systemPrompt: systemPrompt || undefined,
          resume: hasImages ? undefined : opts.resume,
          settingSources: [],
          env,
        },
      });

      for await (const message of iterator) {
        messages.push(message);
        const m = message as {
          type: string;
          subtype?: string;
          session_id?: string;
          result?: string;
          error?: string;
          is_error?: boolean;
          num_turns?: number;
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
            return { status: "ok", sessionId, text: m.result ?? text };
          }
          return {
            status: "error",
            sessionId,
            text,
            error: this.describeResultError(m),
          };
        }
      }
      // result 메시지 없이 스트림이 끝났다 = 서브프로세스가 결과 전에 종료됨
      // (서버 종료·프로세스 kill 등). 진짜 오류가 아닌 '중단'으로 구분한다.
      return {
        status: "error",
        sessionId,
        text,
        error: "에이전트가 결과를 반환하기 전에 실행이 중단되었습니다.",
        interrupted: true,
      };
    } catch (err) {
      this.logger.error(`에이전트 실행 오류: ${String(err)}`);
      return { status: "error", sessionId, text, error: String(err) };
    }
  }
}
