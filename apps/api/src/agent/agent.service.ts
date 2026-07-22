import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import pLimit from "p-limit";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";

export interface RunAgentOptions {
  prompt: string;
  resume?: string;
  systemPrompt?: string;
  maxTurns?: number;
}

export interface RunResult {
  status: "ok" | "error";
  sessionId?: string;
  text: string;
  error?: string;
}

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
  ) {
    const concurrency = this.config.get<number>("AGENT_CONCURRENCY") ?? 3;
    this.limit = pLimit(concurrency);
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

    // 프로젝트별 자격증명 복호화
    const anthropicApiKey =
      this.crypto.decryptOptional(project.anthropicApiKeyEnc) ??
      this.config.get<string>("ANTHROPIC_API_KEY");
    const gitToken = this.crypto.decryptOptional(project.gitTokenEnc);

    const mcpServers = await this.resolveMcpServers(projectId);
    const skillPrompt = await this.resolveSkillPrompt(projectId);
    const systemPrompt = [opts.systemPrompt, skillPrompt]
      .filter(Boolean)
      .join("\n");

    // 서브프로세스로 전달할 env: process.env를 펼쳐 PATH 등 유지 후 프로젝트 키 주입
    const env: Record<string, string | undefined> = { ...process.env };
    if (anthropicApiKey) env.ANTHROPIC_API_KEY = anthropicApiKey;
    if (project.anthropicBaseUrl) env.ANTHROPIC_BASE_URL = project.anthropicBaseUrl;
    if (gitToken) {
      env.GITHUB_TOKEN = gitToken;
      env.GH_TOKEN = gitToken;
    }

    const messages: unknown[] = [];
    let sessionId: string | undefined;
    let text = "";

    try {
      const iterator = query({
        prompt: opts.prompt,
        options: {
          cwd: project.cwd,
          model: project.model ?? undefined,
          maxTurns: opts.maxTurns ?? 20,
          permissionMode: "default",
          allowedTools: project.allowedTools,
          mcpServers: mcpServers as never,
          systemPrompt: systemPrompt || undefined,
          resume: opts.resume,
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
            error: m.error ?? "실행 중 오류가 발생했습니다.",
          };
        }
      }
      return { status: "ok", sessionId, text };
    } catch (err) {
      this.logger.error(`에이전트 실행 오류: ${String(err)}`);
      return { status: "error", sessionId, text, error: String(err) };
    }
  }
}
