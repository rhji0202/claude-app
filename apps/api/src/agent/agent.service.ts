import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import pLimit from "p-limit";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";
import { ClaudeAccountService } from "../claude-account/claude-account.service";
import type { AgentUsage } from "@claude-app/shared";
// 타입 전용 import — 컴파일 시 지워지므로 SDK 런타임 동적 로드에 영향 없다.
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";

/**
 * 에이전트 서브프로세스에 넘길 환경변수 화이트리스트(대문자 비교).
 *
 * 여기 없는 호스트 변수는 서브프로세스에 보이지 않는다 — claude-app의 설정과
 * 셸에 export된 임의 시크릿이 clone 프로젝트로 새는 것을 막는다.
 *
 * 운영은 Linux 컨테이너(node:22-slim)이고 개발은 Windows다. 두 쪽 필수 변수를
 * 모두 담되, 이름 비교는 대문자로 한다 — Windows는 env 이름이 대소문자를
 * 구분하지 않아 SystemRoot/SYSTEMROOT가 섞여 온다.
 *
 * 자격증명(ANTHROPIC_*·GITHUB_TOKEN 등)은 의도적으로 제외했다 — buildEnv가
 * 계정 라우팅으로만 주입해야 하고, 호스트 값이 섞이면 출처가 모호해진다.
 */
const AGENT_ENV_PASSTHROUGH = new Set(
  [
    // --- 공통 필수(빠지면 서브프로세스가 기동조차 못 한다) ---
    "PATH",
    // --- Linux/컨테이너(운영) ---
    "HOSTNAME",
    "USER",
    "LOGNAME",
    "SHLVL",
    "PWD",
    // XDG 경로. 미설정 시 CLI·도구가 $HOME 하위 기본값을 쓴다.
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
    // Node/OpenSSL(prisma 엔진이 컨테이너에서 참조)
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    // --- Windows(개발) ---
    "PATHEXT",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "HOME",
    "HOMEDRIVE",
    "HOMEPATH",
    "USERPROFILE",
    "USERNAME",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "COMMONPROGRAMFILES",
    "PUBLIC",
    "ALLUSERSPROFILE",
    "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "PSMODULEPATH",
    // --- 로케일·셸 ---
    "LANG",
    "LC_ALL",
    "TZ",
    "TERM",
    "SHELL",
    // --- 네트워크(사내 프록시 등 실행에 필요) ---
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    // GitHub Enterprise 등 커스텀 API 엔드포인트. 토큰이 아니라 주소다.
    "GITHUB_API_URL",
    // --- 툴체인 경로(에이전트가 clone에서 빌드·테스트를 돌리는 데 필요) ---
    "NVM_HOME",
    "NVM_SYMLINK",
    "PNPM_HOME",
    "COREPACK_ENABLE_AUTO_PIN",
    "JAVA_HOME",
    "PYENV",
    "PYENV_HOME",
    "PYENV_ROOT",
    "CARGO_HOME",
    "RUSTUP_HOME",
    "GOPATH",
    "GOROOT",
  ].map((k) => k.toUpperCase()),
);

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
  /**
   * 실행 취소 컨트롤러. abort() 하면 SDK가 쿼리를 중단하고 서브프로세스를 정리한다.
   * 이슈 워커의 stale 회수·그레이스풀 셧다운이 살아있는 실행을 실제로 종료하는 데 쓴다.
   */
  abortController?: AbortController;
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
  /** 토큰·비용 사용량(SDK result 메시지에서 추출, 없으면 undefined). */
  usage?: AgentUsage;
  /** 실행에 실제 사용된 Claude 계정 id(활성 계정 폴백 반영). .env 폴백이면 null. */
  accountId?: string | null;
}

/**
 * 스트리밍 실행 중 방출되는 이벤트. claude.ai식 parts 타임라인 모델.
 * 텍스트 세그먼트는 id로 식별 — delta는 누적, text_end는 확정(교체). 중복 방지.
 */
export type AgentStreamEvent =
  | { type: "session"; sessionId: string }
  /**
   * resume 실패로 이전 대화 맥락을 잃고 새 세션으로 재시작했음을 알린다.
   * 지금까지는 조용히 폴백해 사용자가 맥락 소실을 알 방법이 없었다.
   * 알림 전용이라 DB에는 저장하지 않는다.
   */
  | { type: "session_reset"; reason: string }
  /**
   * 턴 종료 시점의 컨텍스트 사용량(CLI 상태줄). 남은 여유를 눈으로 보고
   * 압축·새 세션 시점을 판단하는 용도다. 진행 표시 전용이라 저장하지 않는다.
   */
  | { type: "context_usage"; usedTokens: number; percentage: number }
  /**
   * text·tool 계열 이벤트의 parentId는 서브에이전트 소속을 뜻한다.
   * 값이 있으면 그 id를 가진 Task 도구 파트 **안쪽**에 렌더해야 한다(중첩 트랜스크립트).
   * 없으면 메인 트랜스크립트 소속. forwardSubagentText가 꺼져 있으면 항상 없다.
   */
  | { type: "text_start"; id: string; parentId?: string }
  | { type: "text_delta"; id: string; delta: string; parentId?: string }
  | { type: "text_end"; id: string; text: string; parentId?: string }
  | {
      type: "tool";
      id: string;
      name: string;
      input?: string;
      parentId?: string;
    }
  /**
   * 도구 실행 결과. id는 대응하는 tool 이벤트의 id(tool_use_id)와 같다.
   * CLI 트랜스크립트의 `⎿` 줄에 해당한다. content는 길 수 있어 호출측에서 잘라 쓴다.
   */
  | {
      type: "tool_result";
      id: string;
      content: string;
      isError?: boolean;
      parentId?: string;
    }
  /**
   * 실행 중인 도구의 경과 시간(CLI의 "실행 중 12s"). id는 tool 이벤트의 id와 같다.
   * 같은 도구에 대해 반복 방출되므로 호출측은 갱신(누적 아님)해야 한다.
   * 진행 표시 전용이라 DB에는 저장하지 않는다.
   */
  | { type: "tool_progress"; id: string; elapsedSeconds: number }
  /**
   * 사고 토큰 누적 추정치(CLI 상태줄). 세션 단위이며 특정 파트에 속하지 않는다.
   * 진행 표시 전용이라 DB에는 저장하지 않는다.
   */
  | { type: "thinking_tokens"; tokens: number }
  /**
   * API 재시도 알림(429·5xx 등). 지금까지 조용히 지나가던 구간을 드러낸다.
   * 알림 전용이라 DB에는 저장하지 않는다.
   */
  | {
      type: "api_retry";
      attempt: number;
      maxRetries: number;
      delayMs: number;
      reason: string;
    }
  /**
   * 사용량 한도 알림(구독 계정). status가 allowed_warning·rejected일 때만 의미가 있다.
   * 알림 전용이라 DB에는 저장하지 않는다.
   */
  | {
      type: "rate_limit";
      status: "allowed" | "allowed_warning" | "rejected";
      /** 0~1 사용률. SDK가 주지 않으면 undefined. */
      utilization?: number;
      /** 한도 초기화 시각(ISO). SDK는 epoch 초로 주므로 변환해 넘긴다. */
      resetsAt?: string;
      limitType?: string;
    }
  /**
   * 서브에이전트(Task 도구) 시작. id는 대응하는 tool 이벤트의 id(tool_use_id).
   * tool_use_id가 없는 태스크(워크플로 등)는 방출하지 않는다 — 붙일 파트가 없다.
   */
  | {
      type: "agent_start";
      id: string;
      taskId: string;
      description: string;
      agentType?: string;
    }
  /**
   * 서브에이전트 진행. 같은 id로 반복 방출되므로 호출측은 갱신(누적 아님)해야 한다.
   * summary는 agentProgressSummaries 옵션이 켜져 있을 때만 채워진다.
   */
  | {
      type: "agent_progress";
      id: string;
      taskId: string;
      tokens: number;
      toolUses: number;
      lastToolName?: string;
      summary?: string;
    }
  | {
      type: "done";
      text: string;
      sessionId?: string;
      usage?: AgentUsage;
      accountId?: string | null;
    }
  | {
      type: "error";
      error: string;
      sessionId?: string;
      usage?: AgentUsage;
      accountId?: string | null;
    };

/**
 * 실행 중 세션을 제어하는 핸들. SDK query()의 반환값(Query)이 제공하는 메서드 중
 * 이 앱에서 쓰는 것만 좁혀서 노출한다 — SDK는 런타임 동적 로드이므로 타입을
 * 직접 import하면 서비스가 SDK에 정적으로 묶인다.
 *
 * abortController(서브프로세스 kill)와 다르다: interrupt는 턴만 끊고 지금까지의
 * 부분 응답을 살린 채 세션을 유지한다.
 */
export interface AgentControl {
  /** 현재 턴을 중단한다. 부분 응답은 보존되고 세션은 살아있다. */
  interrupt(): Promise<unknown>;
  /** 세션 재시작 없이 모델을 교체한다. 인자 생략 시 기본 모델로 되돌린다. */
  setModel(model?: string): Promise<void>;
  /** 이 세션에서 실제로 사용 가능한 슬래시 명령 목록. */
  supportedCommands(): Promise<unknown[]>;
  /** 컨텍스트 사용량(카테고리별 토큰·percentage 등). */
  getContextUsage(): Promise<unknown>;
}

export interface RunStreamOptions extends RunAgentOptions {
  /**
   * 스트림이 열린 직후 제어 핸들을 넘겨준다(호출측이 interrupt 등을 걸 수 있게).
   * resume 폴백으로 재시도되면 새 핸들로 다시 호출된다 — 호출측은 마지막 것만 유지한다.
   */
  onQuery?: (control: AgentControl) => void;
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
    private readonly claudeAccounts: ClaudeAccountService,
  ) {
    const concurrency = this.config.get<number>("AGENT_CONCURRENCY") ?? 3;
    this.limit = pLimit(concurrency);
  }

  /**
   * SDK 서브프로세스로 전달할 env 조립.
   * - env는 화이트리스트로 새로 만든다(호스트 값 상속 차단) — 아래 상세.
   * - Anthropic 자격증명 우선순위: 프로젝트 지정 계정 → 실행 사용자 활성 계정 → .env 폴백.
   * - git 토큰: 프로젝트 gitToken → GITHUB_TOKEN/GH_TOKEN.
   */
  private async buildEnv(
    userId: string | undefined,
    gitToken: string | null,
    claudeAccountId?: string | null,
    /** 프로젝트 지정 계정의 기대 소유자(=프로젝트 owner). 읽기 시점 소유권 재확인용. */
    accountOwnerId?: string | null,
  ): Promise<{
    env: Record<string, string | undefined>;
    /** 실제 자격증명을 제공한 계정 id. 사용자 활성 계정 폴백도 반영. .env 폴백이면 null. */
    accountId: string | null;
  }> {
    // 서브프로세스 env는 화이트리스트로 새로 만든다(호스트 env 복사 아님).
    //
    // 에이전트는 clone 프로젝트를 cwd로 실행되고, 그 안에서 서버·마이그레이션을
    // 띄우면 이 env를 손자 프로세스로 물려받는다. dotenv는 이미 설정된 값을
    // 덮어쓰지 않으므로(override:false 기본) clone의 .env가 지고, 남의 프로젝트가
    // claude-app의 DATABASE_URL을 가리켰다(실측 확인).
    //
    // 블랙리스트(envSchema 키 제거)로는 부족했다 — 셸에 export된 임의 시크릿
    // (GITHUB_PERSONAL_ACCESS_TOKEN 등)은 스키마에 없어 그대로 샜다. 넘길 키를
    // 명시적으로 고르면 이름을 모르는 변수까지 차단된다.
    //
    // 목록에서 빠진 변수는 조용히 사라지므로 추가는 신중히. 자격증명은 여기
    // 넣지 말 것 — 아래에서 계정 라우팅으로만 주입한다.
    const env: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (AGENT_ENV_PASSTHROUGH.has(key.toUpperCase())) env[key] = value;
    }

    // 실행 자격증명 우선순위: 프로젝트 지정 계정 → 사용자 활성 계정 → .env 폴백.
    // 사용량 귀속을 위해 토큰뿐 아니라 실제로 쓰인 계정 id도 함께 확정한다.
    let token: string | null = null;
    let accountId: string | null = null;
    if (claudeAccountId) {
      token = await this.claudeAccounts.getTokenById(
        claudeAccountId,
        accountOwnerId,
      );
      if (token) accountId = claudeAccountId;
    }
    if (!token && userId) {
      token = await this.claudeAccounts.getActiveToken(userId);
      if (token) accountId = await this.claudeAccounts.getActiveAccountId(userId);
    }
    if (!token) {
      token = this.config.get<string>("ANTHROPIC_OAUTH_TOKEN") ?? null;
      // .env 폴백은 특정 계정에 귀속되지 않으므로 accountId는 null로 둔다.
    }

    // 값이 없거나 어느 쪽이든, 두 자격증명이 동시에 있으면 CLI가 혼동하므로 정리한다.
    delete env.ANTHROPIC_API_KEY;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    if (token) {
      // sk-ant-oat…은 OAuth 토큰(구독/CLI 로그인) → OAuth 경로. 그 외는 API 키.
      if (token.startsWith("sk-ant-oat")) env.CLAUDE_CODE_OAUTH_TOKEN = token;
      else env.ANTHROPIC_API_KEY = token;
    }

    // git 자격증명도 프로젝트 설정이 유일한 출처다. 호스트에 남은 값이 상속되면
    // 프로젝트 토큰이 없을 때 claude-app의 토큰으로 남의 저장소에 접근하게 된다.
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    if (gitToken) {
      env.GITHUB_TOKEN = gitToken;
      env.GH_TOKEN = gitToken;
    }
    return { env, accountId };
  }

  /**
   * 실행에 쓸 모델·effort 해석. 계정 지정값 우선, 없으면 env 전역 기본
   * (ANTHROPIC_MODEL / ANTHROPIC_EFFORT). SDK query options.model/effort로 전달된다.
   * effort=null이면 options.effort를 아예 넘기지 않는다(CLI 기본값 사용).
   */
  private async resolveModel(
    userId: string | undefined,
    claudeAccountId?: string | null,
  ): Promise<{ model: string; effort: EffortLevel | null }> {
    const cfg = await this.claudeAccounts.getModelConfig(userId, claudeAccountId);
    const model =
      cfg.model ?? this.config.get<string>("ANTHROPIC_MODEL") ?? "claude-opus-5";
    // effort 미지원 모델(Haiku 등)은 env 전역 기본으로도 폴백하지 않는다 —
    // 계정은 Haiku인데 effort는 전역값에서 흘러드는 경로를 막는다.
    const effort = cfg.effortSupported
      ? ((cfg.effort ??
          this.config.get<string>("ANTHROPIC_EFFORT") ??
          "high") as EffortLevel)
      : null;
    return { model, effort };
  }

  /**
   * effort는 SDK Options.effort(1급 필드)로 전달한다. 과거에는 타입에 없어
   * CLAUDE_CODE_EFFORT_LEVEL env로 우회했는데, 그 경로는 low|medium|high만
   * 해석해 xhigh·max가 조용히 무시됐다.
   *
   * 주의: CLI는 잘못된 effort 값도 오류 없이 받아들인다(실측 확인). 즉 런타임
   * 방어가 없으므로 resolveModel의 EffortLevel 타입이 유일한 안전장치다.
   *
   * env 키는 여기서 지운다 — buildEnv가 {...process.env}를 복사하므로 호스트에
   * 남은 값이 상속되어 Options.effort와 충돌·오작동할 수 있다.
   */
  private clearEffortEnv(env: Record<string, string | undefined>): void {
    delete env.CLAUDE_CODE_EFFORT_LEVEL;
  }

  /**
   * CLI가 세션 트랜스크립트를 보관하는 디렉터리.
   *
   * CLI는 세션을 **작업 디렉터리별로** 저장한다(`~/.claude/projects/<cwd를 인코딩한 이름>/`).
   * 경로 인코딩 규칙은 구분자(`:`·`\`·`/`)를 `-`로 바꾸는 것이다.
   * 예) `E:\a\b` → `E--a-b`
   */
  private sessionDirFor(cwd: string): string {
    const encoded = path.resolve(cwd).replace(/[\\/:]/g, "-");
    return path.join(os.homedir(), ".claude", "projects", encoded);
  }

  /**
   * 다른 작업 디렉터리에서 만들어진 세션을 지정한 cwd로 복사해 resume 가능하게 한다.
   *
   * CLI는 cwd로 세션을 찾으므로, 이슈 worktree에서 만든 세션은 채팅의 clone base에서
   * 그대로 resume할 수 없다("No conversation found with session ID"). 트랜스크립트
   * 파일을 대상 디렉터리로 복사하면 같은 세션 id로 이어받을 수 있다.
   *
   * 원본이 없거나(worktree 정리 후 CLI 세션까지 지워진 경우) 복사에 실패하면 false를
   * 돌려준다 — 호출측은 맥락 없이 새 세션으로 시작하면 된다.
   *
   * @param sessionId 이어받을 SDK 세션 id
   * @param fromCwd   그 세션이 만들어진 작업 디렉터리
   * @param toCwd     이어서 실행할 작업 디렉터리
   */
  async transferSession(
    sessionId: string,
    fromCwd: string,
    toCwd: string,
  ): Promise<boolean> {
    const src = path.join(this.sessionDirFor(fromCwd), `${sessionId}.jsonl`);
    const destDir = this.sessionDirFor(toCwd);
    const dest = path.join(destDir, `${sessionId}.jsonl`);
    try {
      if (src === dest) return true; // 같은 디렉터리면 할 일이 없다
      await fs.access(src);
      await fs.mkdir(destDir, { recursive: true });
      // 이미 옮겨둔 세션이면 덮어쓰지 않는다 — 대화가 진행됐을 수 있다.
      try {
        await fs.access(dest);
        return true;
      } catch {
        /* 없으면 아래에서 복사 */
      }
      await fs.copyFile(src, dest);
      this.logger.log(`세션 이관: ${sessionId} → ${destDir}`);
      return true;
    } catch (err) {
      this.logger.warn(`세션 이관 실패 ${sessionId}: ${String(err)}`);
      return false;
    }
  }

  /**
   * SDK query()에 넘길 prompt를 만든다.
   * 이미지가 없으면 문자열 그대로, 있으면 멀티모달 content block을 담은
   * AsyncIterable(SDKUserMessage 1개)로 감싼다.
   *
   * 중요: 반환된 제너레이터는 1회용이다. resume 폴백으로 재시도할 때는 반드시
   * 이 메서드를 다시 호출해야 한다 — 소비된 제너레이터를 재사용하면 재시도가
   * 빈 프롬프트로 나간다.
   */
  private makePrompt(opts: RunAgentOptions): string | AsyncIterable<unknown> {
    const images = opts.images ?? [];
    if (images.length === 0) return opts.prompt;
    const prompt = opts.prompt;
    return (async function* () {
      yield {
        type: "user" as const,
        parent_tool_use_id: null,
        message: {
          role: "user" as const,
          content: [
            { type: "text" as const, text: prompt },
            ...images.map((im) => ({
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
    })();
  }

  /**
   * Query.getContextUsage()의 반환값에서 사용량을 뽑는다.
   *
   * SDK 타입이 unknown이라 형태를 신뢰할 수 없다. 기대 키가 없거나 숫자가
   * 아니면 null을 돌려 호출측이 조용히 생략하게 한다 — 표시 전용 값이므로
   * 여기서 실패해도 대화는 그대로 진행되어야 한다.
   */
  private parseContextUsage(
    raw: unknown,
  ): { usedTokens: number; percentage: number } | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    // SDK 버전에 따라 키 이름이 갈린다. 둘 다 받아준다.
    const used = o.usedTokens ?? o.used_tokens ?? o.totalTokens ?? o.total_tokens;
    const pct = o.percentage ?? o.percent ?? o.utilization;
    if (typeof used !== "number" || !Number.isFinite(used)) return null;
    if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
    // utilization은 0~1로 올 수 있다 — 백분율로 맞춘다.
    return { usedTokens: used, percentage: pct <= 1 ? pct * 100 : pct };
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
    const { env, accountId } = await this.buildEnv(
      opts.userId,
      gitToken,
      project.claudeAccountId,
      project.ownerId,
    );
    const { model, effort } = await this.resolveModel(
      opts.userId,
      project.claudeAccountId,
    );
    this.clearEffortEnv(env);

    let sessionId: string | undefined;
    let finalText = "";
    /**
     * 가장 최근에 열린 assistant 메시지 id. message_start에서 걸어두고
     * content_block_start가 읽는다(블록 이벤트에는 메시지 id가 없다).
     * 서브에이전트는 스트림이 메인과 섞여 오므로 parent별로 따로 보관한다.
     */
    const streamingMsgId = new Map<string, string>();
    /**
     * 열려 있는 텍스트 블록의 소속 메시지 id (`${parent}#${index}` → msgId).
     *
     * 델타는 streamingMsgId를 직접 읽지 않고 이 값을 읽는다. 앞 메시지가
     * 완결되기 전에 다음 message_start가 오면 streamingMsgId는 덮어써지는데,
     * 그때도 이미 열린 블록의 남은 델타는 원래 메시지 파트에 붙어야 한다.
     * (덮어쓴 값을 읽으면 같은 텍스트가 두 파트로 갈려 중복 렌더된다.)
     */
    let blockMsgId = new Map<string, string>();
    // 메시지 id가 없는 SDK 이벤트를 위한 폴백 카운터.
    let fallbackSeq = 0;
    /**
     * message_start에 id가 없어 폴백 id로 연 스트림 (parent → 폴백 id).
     *
     * 완결 assistant 메시지는 자기 message.id를 우선 쓰는데, 스트리밍이 폴백
     * id로 파트를 열었으면 둘이 갈려 같은 답변이 두 파트로 렌더된다. 폴백으로
     * 열린 경우에만 완결 메시지가 그 id를 이어받도록 여기 기록한다.
     */
    let fallbackMsgId = new Map<string, string>();
    /**
     * 완결 assistant 메시지의 다음 블록 인덱스 (`${parent}#${msgId}` → 다음 index).
     *
     * SDK는 한 논리적 메시지를 **같은 message.id를 가진 여러 assistant 메시지**로
     * 쪼개 보내고, 각 메시지의 content 배열은 0부터 다시 시작한다. 반면 스트림
     * 이벤트의 index는 메시지 전체 기준이라(thinking=0, text=1 …) 배열 위치를
     * 그대로 쓰면 id가 갈려 같은 텍스트가 두 파트로 렌더된다.
     *
     * 그래서 메시지별로 지금까지 받은 블록 수를 누적해 실제 인덱스를 복원한다.
     */
    let msgBlockOffset = new Map<string, number>();
    // content_block_start로 열린 텍스트 블록의 id (index → true). text_start 중복 방지.
    let openedText = new Set<string>();
    // 클라이언트에 실제 내용(text/tool/done)을 방출했는가. resume 실패 폴백 판단용
    // (init만 오고 서브프로세스가 죽는 경우 아직 false → 새 세션 재시도 안전).
    let sawContent = false;
    // 현재 실행이 resume을 사용 중인가(폴백 재시도 시 false로 낮춘다).
    let resumeInFlight = Boolean(opts.resume);

    /**
     * 텍스트 세그먼트 id = `${assistant 메시지 id}:${blockIndex}`.
     * 가변 카운터가 아니라 SDK가 주는 메시지 id에 묶으므로, 다음 턴의
     * message_start가 앞 턴의 완결 assistant 메시지보다 먼저 도착해도
     * 델타와 text_end가 같은 파트로 수렴한다(중복 렌더 방지).
     *
     * 서브에이전트(parent 있음)는 별도 이름공간을 쓴다 — 메시지 id가 겹칠 때
     * 메인 스레드의 텍스트를 덮어쓰지 않게 한다.
     */
    const segId = (msgId: string, index: number, parent?: string | null) =>
      parent ? `${parent}#${msgId}:${index}` : `${msgId}:${index}`;

    /** parent별 스트리밍 메시지 id 키(메인은 빈 문자열). */
    const msgKey = (parent?: string | null) => parent ?? "";

    /** 열린 텍스트 블록 키 — parent와 블록 인덱스로 소속 메시지를 찾는다. */
    const blockKey = (index: number, parent?: string | null) =>
      `${parent ?? ""}#${index}`;

    // 실제 SDK 스트림 1회. done/error를 onEvent로 방출하면 true 반환(정상 종료),
    // 내용 방출 전 예외가 나면 throw(호출측이 resume 폴백 여부 판단).
    const runOnce = async (resume?: string): Promise<boolean> => {
      const iterator = query({
        // 이미지가 있으면 멀티모달 블록으로 감싼다. runOnce 안에서 만들어야
        // resume 폴백 재시도가 새 제너레이터를 받는다(1회용이므로).
        prompt: this.makePrompt(opts) as never,
        options: {
          // 실행 디렉터리는 항상 호출측이 주입한 worktree 경로(설계 12.5). project.cwd 미사용.
          cwd: opts.cwd,
          model,
          // null이면 키를 생략해 CLI 기본값을 쓴다(effort 미지원 모델).
          ...(effort ? { effort } : {}),
          maxTurns: opts.maxTurns ?? 20,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          // 서브에이전트 진행 요약(~30초마다). 서브에이전트 대화를 포크해 만들지만
          // 프롬프트 캐시를 재사용하므로 비용은 미미하다. task_progress.summary로 온다.
          agentProgressSummaries: true,
          // 서브에이전트의 텍스트·도구 호출까지 전달받아 중첩 트랜스크립트를 그린다.
          // 이 이벤트들은 parent_tool_use_id를 갖고 오므로 메인 타임라인과 분리해야 한다.
          forwardSubagentText: true,
          mcpServers: mcpServers as never,
          systemPrompt: systemPrompt || undefined,
          resume,
          settingSources: [],
          env,
          // 취소 시 SDK가 쿼리를 중단하고 서브프로세스를 정리한다.
          abortController: opts.abortController,
        },
      });

      // query()의 반환값은 단순 iterator가 아니라 Query — interrupt/setModel 등
      // 제어 메서드를 갖는다. 호출측에 넘겨 세션 제어가 가능하게 한다.
      opts.onQuery?.(iterator as unknown as AgentControl);

      for await (const message of iterator) {
        const m = message as {
          type: string;
          subtype?: string;
          session_id?: string;
          result?: string;
          errors?: string[];
          terminal_reason?: string;
          error?: string;
          num_turns?: number;
          total_cost_usd?: number;
          duration_ms?: number;
          usage?: Record<string, number>;
          modelUsage?: Record<string, unknown>;
          // tool_progress 필드
          tool_use_id?: string;
          elapsed_time_seconds?: number;
          parent_tool_use_id?: string | null;
          // system/thinking_tokens 필드
          estimated_tokens?: number;
          // system/task_started·task_progress 필드
          task_id?: string;
          description?: string;
          subagent_type?: string;
          last_tool_name?: string;
          summary?: string;
          // system/api_retry 필드
          attempt?: number;
          max_retries?: number;
          retry_delay_ms?: number;
          error_status?: number | null;
          // rate_limit_event 필드
          rate_limit_info?: {
            status?: string;
            utilization?: number;
            resetsAt?: number;
            rateLimitType?: string;
          };
          event?: {
            type?: string;
            index?: number;
            // message_start에만 있다 — 텍스트 세그먼트 id의 기준.
            message?: { id?: string };
            content_block?: { type?: string };
            delta?: { type?: string; text?: string };
          };
          message?: {
            id?: string;
            content?: Array<{
              type: string;
              text?: string;
              id?: string;
              name?: string;
              input?: unknown;
              // tool_result 블록 필드
              tool_use_id?: string;
              is_error?: boolean;
              content?: unknown;
            }>;
          };
        };

        if (m.type === "system" && m.subtype === "init" && m.session_id) {
          sessionId = m.session_id;
          onEvent({ type: "session", sessionId });
        }

        // 도구 진행(경과 시간). 서브에이전트 내부 도구(parent_tool_use_id 있음)는
        // 프론트에 대응하는 파트가 없으므로 건너뛴다.
        if (
          m.type === "tool_progress" &&
          m.tool_use_id &&
          typeof m.elapsed_time_seconds === "number" &&
          !m.parent_tool_use_id
        ) {
          onEvent({
            type: "tool_progress",
            id: m.tool_use_id,
            elapsedSeconds: m.elapsed_time_seconds,
          });
        }

        // 사고 토큰 누적 추정치(상태줄용).
        if (
          m.type === "system" &&
          m.subtype === "thinking_tokens" &&
          typeof m.estimated_tokens === "number"
        ) {
          onEvent({ type: "thinking_tokens", tokens: m.estimated_tokens });
        }

        // API 재시도(429·5xx 등). 지금까지 조용히 지나가 사용자에게 멈춘 것처럼 보였다.
        if (
          m.type === "system" &&
          m.subtype === "api_retry" &&
          typeof m.attempt === "number"
        ) {
          onEvent({
            type: "api_retry",
            attempt: m.attempt,
            maxRetries: Number(m.max_retries ?? 0),
            delayMs: Number(m.retry_delay_ms ?? 0),
            // error는 SDK가 주는 사유 코드(rate_limit·overloaded 등).
            reason: m.error ?? (m.error_status ? String(m.error_status) : "unknown"),
          });
        }

        // 사용량 한도(구독 계정). 경고·차단만 의미가 있으므로 allowed는 흘리지 않는다.
        if (m.type === "rate_limit_event" && m.rate_limit_info) {
          const info = m.rate_limit_info;
          const status = info.status;
          if (status === "allowed_warning" || status === "rejected") {
            onEvent({
              type: "rate_limit",
              status,
              utilization: info.utilization,
              // SDK는 epoch 초를 준다 — 프론트가 바로 쓰도록 ISO로 변환한다.
              resetsAt:
                typeof info.resetsAt === "number"
                  ? new Date(info.resetsAt * 1000).toISOString()
                  : undefined,
              limitType: info.rateLimitType,
            });
          }
        }

        // 서브에이전트(Task 도구) 시작·진행. tool_use_id가 없는 태스크(워크플로 등)는
        // 프론트에 붙일 파트가 없으므로 건너뛴다.
        if (m.type === "system" && m.subtype === "task_started" && m.tool_use_id) {
          onEvent({
            type: "agent_start",
            id: m.tool_use_id,
            taskId: m.task_id ?? m.tool_use_id,
            description: m.description ?? "",
            agentType: m.subagent_type,
          });
        }
        if (m.type === "system" && m.subtype === "task_progress" && m.tool_use_id) {
          onEvent({
            type: "agent_progress",
            id: m.tool_use_id,
            taskId: m.task_id ?? m.tool_use_id,
            tokens: Number(m.usage?.total_tokens ?? 0),
            toolUses: Number(m.usage?.tool_uses ?? 0),
            lastToolName: m.last_tool_name,
            summary: m.summary,
          });
        }

        if (m.type === "stream_event" && m.event) {
          const ev = m.event;
          // 서브에이전트 소속이면 그 Task 파트 안쪽에 렌더된다.
          const parent = m.parent_tool_use_id ?? undefined;
          if (ev.type === "message_start") {
            // 이 메시지의 후속 블록 이벤트가 쓸 id를 걸어둔다. id가 없으면
            // 폴백 시퀀스로 대체해 최소한 메시지 간 충돌은 막는다.
            const key = msgKey(parent);
            const streamId = ev.message?.id ?? `seq${(fallbackSeq += 1)}`;
            streamingMsgId.set(key, streamId);
            // id 없이 연 스트림은 뒤에 오는 완결 메시지가 자기 message.id를 쓰면
            // 파트가 갈린다(같은 답변이 두 번 렌더). 폴백으로 열었다는 사실을
            // 남겨, 완결 메시지가 이 id를 그대로 이어받게 한다.
            if (ev.message?.id) fallbackMsgId.delete(key);
            else fallbackMsgId.set(key, streamId);
          } else if (
            ev.type === "content_block_start" &&
            ev.content_block?.type === "text" &&
            typeof ev.index === "number"
          ) {
            const msgId = streamingMsgId.get(msgKey(parent));
            // message_start를 놓쳤으면 이 블록의 소속을 알 수 없다 — 뒤늦게 오는
            // 완결 메시지가 파트를 만들도록 넘긴다(중복 생성 방지).
            if (msgId) {
              // 이 블록의 소속을 고정한다. 뒤이어 다른 message_start가 와도
              // 남은 델타는 이 값을 읽어 같은 파트에 머문다.
              blockMsgId.set(blockKey(ev.index, parent), msgId);
              const id = segId(msgId, ev.index, parent);
              openedText.add(id);
              sawContent = true;
              onEvent({ type: "text_start", id, parentId: parent });
            }
          } else if (
            ev.type === "content_block_delta" &&
            ev.delta?.type === "text_delta" &&
            ev.delta.text &&
            typeof ev.index === "number"
          ) {
            // content_block_start에서 고정한 소속을 읽는다 — streamingMsgId를
            // 읽으면 뒤에 온 message_start에 오염돼 파트가 갈라진다.
            const msgId = blockMsgId.get(blockKey(ev.index, parent));
            if (msgId) {
              sawContent = true;
              onEvent({
                type: "text_delta",
                id: segId(msgId, ev.index, parent),
                delta: ev.delta.text,
                parentId: parent,
              });
            }
          } else if (
            ev.type === "content_block_stop" &&
            typeof ev.index === "number"
          ) {
            // 블록이 닫혔으니 고정을 푼다 — 다음 메시지가 같은 인덱스를
            // 다시 쓸 때 앞 메시지의 소속이 남아 있지 않게 한다.
            blockMsgId.delete(blockKey(ev.index, parent));
          }
        }

        // 완결된 assistant 턴 — 텍스트 블록 확정(text_end) + tool_use 블록
        if (m.type === "assistant" && m.message?.content) {
          sawContent = true;
          const parent = m.parent_tool_use_id ?? undefined;
          // 완결 메시지는 자기 id를 갖고 온다 — 스트리밍 중 걸어둔 값에
          // 의존하지 않으므로 메시지 순서가 뒤바뀌어도 id가 갈라지지 않는다.
          //
          // 단, 스트리밍이 폴백 id로 파트를 이미 열었다면 그 id를 이어받는다.
          // 여기서 message.id로 갈아타면 같은 텍스트가 두 파트로 렌더된다.
          const msgId =
            fallbackMsgId.get(msgKey(parent)) ??
            m.message.id ??
            streamingMsgId.get(msgKey(parent)) ??
            `seq${(fallbackSeq += 1)}`;
          // 같은 메시지가 여러 번 쪼개져 오므로, 배열 위치가 아니라 누적 오프셋으로
          // 실제 블록 인덱스를 복원한다(스트림 이벤트의 index와 맞추기 위함).
          const offsetKey = `${parent ?? ""}#${msgId}`;
          const base = msgBlockOffset.get(offsetKey) ?? 0;
          msgBlockOffset.set(offsetKey, base + m.message.content.length);
          m.message.content.forEach((block, i) => {
            const index = base + i;
            if (block.type === "text" && block.text) {
              const id = segId(msgId, index, parent);
              // 델타가 없었던(스트리밍 안 된) 텍스트면 start도 보내 프론트가 파트를 만들게 함
              if (!openedText.has(id))
                onEvent({ type: "text_start", id, parentId: parent });
              onEvent({ type: "text_end", id, text: block.text, parentId: parent });
            } else if (block.type === "tool_use" && block.name) {
              let input: string | undefined;
              try {
                input = block.input ? JSON.stringify(block.input) : undefined;
              } catch {
                input = undefined;
              }
              onEvent({
                type: "tool",
                id: block.id ?? segId(msgId, index, parent),
                name: block.name,
                input,
                parentId: parent,
              });
            }
          });
          // 이 메시지는 끝났다 — 폴백 id 인계는 여기까지다. 남겨두면 다음 턴의
          // 완결 메시지가 앞 턴 id를 물려받아 서로 다른 답변이 한 파트로 합쳐진다.
          fallbackMsgId.delete(msgKey(parent));
        }

        // 도구 실행 결과 — SDK는 tool_result 블록을 user 메시지로 되돌려준다.
        if (m.type === "user" && m.message?.content) {
          const parent = m.parent_tool_use_id ?? undefined;
          for (const block of m.message.content) {
            if (block.type !== "tool_result" || !block.tool_use_id) continue;
            onEvent({
              type: "tool_result",
              id: block.tool_use_id,
              content: this.flattenToolResult(block.content),
              isError: block.is_error === true,
              parentId: parent,
            });
          }
        }

        if (m.type === "result") {
          const usage = this.parseUsage(m);
          if (m.subtype === "success") {
            // 컨텍스트 잔량을 상태줄에 남긴다. 표시 전용이므로 실패는 무시한다
            // (SDK 버전에 따라 메서드가 없거나 형태가 다를 수 있다).
            try {
              const ctx = this.parseContextUsage(
                await (iterator as unknown as AgentControl).getContextUsage(),
              );
              if (ctx) onEvent({ type: "context_usage", ...ctx });
            } catch {
              /* 컨텍스트 조회 실패는 대화에 영향을 주지 않는다 */
            }
            onEvent({
              type: "done",
              text: m.result ?? finalText,
              sessionId,
              usage,
              accountId,
            });
          } else {
            onEvent({
              type: "error",
              error: this.describeResultError(m),
              sessionId,
              usage,
              accountId,
            });
          }
          return true;
        }
      }
      // result 없이 스트림 종료 = 결과 전에 실행이 중단됨. 성공으로 오인 금지.
      // 내용 없이 조기 종료 + resume이 있었으면 폴백 대상이므로 throw로 넘긴다.
      if (!sawContent && resumeInFlight) {
        throw new Error("결과 없이 스트림이 조기 종료되었습니다.");
      }
      onEvent({
        type: "error",
        error: "에이전트가 결과를 반환하기 전에 실행이 중단되었습니다.",
        sessionId,
      });
      return true;
    };

    // resume 시도 → 내용 방출 전 실패 시 새 세션으로 1회 재시도.
    try {
      await runOnce(opts.resume);
    } catch (err) {
      // 알 수 없는 세션 resume은 CLI 서브프로세스를 exit 1로 죽인다(init 직후 예외).
      // 클라이언트에 내용을 아직 안 보냈으면 resume 없이 새 세션으로 재시도한다.
      if (opts.resume && !sawContent) {
        this.logger.warn(
          `resume(${opts.resume}) 실패 — 새 세션으로 재시도: ${String(err)}`,
        );
        // 맥락이 사라진 채 답변이 오는 이유를 사용자가 알 수 있게 알린다.
        onEvent({
          type: "session_reset",
          reason: "이전 대화 맥락을 불러오지 못했습니다.",
        });
        // 재시도 전 파트 상태 초기화. 메시지 id는 새 세션에서도 새로 발급되므로
        // 카운터 되돌림은 필요 없고, 걸어둔 스트리밍 id만 비운다.
        resumeInFlight = false;
        streamingMsgId.clear();
        blockMsgId = new Map<string, string>();
        fallbackMsgId = new Map<string, string>();
        msgBlockOffset = new Map<string, number>();
        openedText = new Set<string>();
        try {
          await runOnce(undefined);
          return;
        } catch (err2) {
          this.logger.error(`재시도 실패: ${String(err2)}`);
          onEvent({ type: "error", error: String(err2), sessionId });
          return;
        }
      }
      this.logger.error(`스트리밍 실행 오류: ${String(err)}`);
      onEvent({ type: "error", error: String(err), sessionId });
    }
  }

  /**
   * tool_result 블록의 content를 평문으로 만든다.
   * SDK는 문자열 또는 블록 배열(text 블록 등)을 준다. 이미지 등 텍스트가 아닌
   * 블록은 타입 표시로 대체한다.
   *
   * 파일 전체 읽기처럼 결과가 매우 클 수 있어 상한을 둔다 — SSE·DB(parts)에
   * 그대로 흘리면 응답이 비대해지고, UI는 어차피 앞부분만 보여준다.
   */
  private flattenToolResult(content: unknown): string {
    const MAX = 4000;
    let text: string;
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      text = content
        .map((b) => {
          const block = b as { type?: string; text?: string };
          if (typeof block?.text === "string") return block.text;
          return block?.type ? `[${block.type}]` : "";
        })
        .filter(Boolean)
        .join("\n");
    } else if (content == null) text = "";
    else text = JSON.stringify(content);

    if (text.length <= MAX) return text;
    return `${text.slice(0, MAX)}\n… (${text.length - MAX}자 생략)`;
  }

  /**
   * SDK result 메시지(비성공)에서 사람이 읽을 오류 문구를 만든다.
   * SDK는 종료 사유를 subtype으로 준다(error_max_turns 등). 명시 error가 없을 때
   * 무의미한 폴백 대신 subtype·턴 수를 남겨 원인 추적이 가능하게 한다.
   */
  /**
   * SDK result 메시지에서 토큰·비용 사용량을 추출한다(success·error 양쪽 존재).
   * total_cost_usd를 신뢰 비용값으로, 토큰은 usage(snake_case), 모델은 modelUsage 키에서 얻는다.
   * 사용량 정보가 전혀 없으면 undefined.
   */
  private parseUsage(m: {
    total_cost_usd?: number;
    num_turns?: number;
    duration_ms?: number;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    modelUsage?: Record<string, unknown>;
  }): AgentUsage | undefined {
    if (m.total_cost_usd === undefined && !m.usage && !m.modelUsage)
      return undefined;
    const u = m.usage ?? {};
    // modelUsage 키가 실제 사용 모델명. 여러 개면 costUSD가 가장 큰 것을 대표로.
    let model: string | null = null;
    if (m.modelUsage) {
      const entries = Object.entries(m.modelUsage);
      let best = -1;
      for (const [name, mu] of entries) {
        const cost = Number((mu as { costUSD?: number })?.costUSD ?? 0);
        if (cost >= best) {
          best = cost;
          model = name;
        }
      }
    }
    return {
      costUsd: Number(m.total_cost_usd ?? 0),
      inputTokens: Number(u.input_tokens ?? 0),
      outputTokens: Number(u.output_tokens ?? 0),
      cacheReadTokens: Number(u.cache_read_input_tokens ?? 0),
      cacheCreationTokens: Number(u.cache_creation_input_tokens ?? 0),
      model,
      durationMs: m.duration_ms ?? null,
      numTurns: m.num_turns ?? null,
    };
  }

  private describeResultError(m: {
    subtype?: string;
    /** SDK가 실제로 주는 필드. 단수 error는 없다. */
    errors?: string[];
    /** 종료 원인 상세(max_turns·api_error·prompt_too_long 등). 있으면 함께 노출. */
    terminal_reason?: string;
    error?: string;
    num_turns?: number;
  }): string {
    // SDK result 메시지는 errors: string[]를 준다. 과거 코드가 단수 m.error만
    // 봤기 때문에 실제 오류 내용이 항상 버려지고 subtype 폴백 문구만 남았다.
    const detail =
      m.errors?.filter((e) => e && e.trim()).join("; ") || m.error?.trim();
    if (detail) return detail;

    // 오류 문구가 비어 있을 때만 종료 사유로 문장을 만든다.
    const reason =
      m.subtype === "error_max_turns"
        ? `최대 턴 수(${m.num_turns ?? "?"}턴)에 도달해 중단되었습니다.`
        : m.subtype === "error_max_budget_usd"
          ? "실행 비용이 예산 상한에 도달해 중단되었습니다."
          : m.subtype === "error_max_structured_output_retries"
            ? "구조화 출력 재시도 한도를 초과했습니다."
            : m.subtype === "error_during_execution"
              ? "실행 중 오류가 발생했습니다."
              : `실행이 비정상 종료되었습니다 (${m.subtype ?? "unknown"}).`;
    // terminal_reason은 subtype보다 구체적이라 원인 추적에 도움이 된다.
    return m.terminal_reason ? `${reason} (${m.terminal_reason})` : reason;
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

    const { env, accountId } = await this.buildEnv(
      opts.userId,
      gitToken,
      project.claudeAccountId,
      project.ownerId,
    );
    const { model, effort } = await this.resolveModel(
      opts.userId,
      project.claudeAccountId,
    );
    this.clearEffortEnv(env);

    let sessionId: string | undefined;
    let text = "";
    // assistant 내용(text)을 받았는가. resume 실패 폴백 판단용
    // (init만 오고 서브프로세스가 죽으면 false → 새 세션 재시도 안전).
    let sawContent = false;

    // 현재 실행이 resume 사용 중인가(폴백 재시도 시 false로 낮춤).
    let resumeInFlight = Boolean(opts.resume);
    // 이미지 첨부에도 resume을 유지한다. 채팅은 멀티턴이라 이미지를 붙일 때마다
    // 세션이 끊기면 앞 대화를 잃는다. 세션을 잇는 것은 options.resume 하나이며,
    // SDKUserMessage의 session_id는 출력 메타 필드라 입력에서 지정하지 않는다.

    // SDK 스트림 1회. 결과가 나오면 RunResult 반환, 결과 없이 스트림이 끝나면 중단(interrupted).
    // 메시지 방출 전 예외는 그대로 throw(호출측이 resume 폴백 판단).
    const runOnce = async (resume?: string): Promise<RunResult> => {
      const iterator = query({
        // runOnce 안에서 만들어야 resume 폴백 재시도가 새 제너레이터를 받는다(1회용).
        prompt: this.makePrompt(opts) as never,
        options: {
          // 실행 디렉터리는 항상 호출측이 주입한 worktree 경로(설계 12.5). project.cwd 미사용.
          cwd: opts.cwd,
          model,
          // null이면 키를 생략해 CLI 기본값을 쓴다(effort 미지원 모델).
          ...(effort ? { effort } : {}),
          maxTurns: opts.maxTurns ?? 20,
          // 전체 bypass 실행. 헤드리스 서버 컨텍스트라 권한 프롬프트가 불가능하므로
          // 모든 도구(bash 포함)를 무프롬프트로 실행한다. bypass에는 이 플래그가 필요.
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          mcpServers: mcpServers as never,
          systemPrompt: systemPrompt || undefined,
          resume,
          settingSources: [],
          env,
          // 취소 시 SDK가 쿼리를 중단하고 서브프로세스를 정리한다.
          abortController: opts.abortController,
        },
      });

      for await (const message of iterator) {
        const m = message as {
          type: string;
          subtype?: string;
          session_id?: string;
          result?: string;
          errors?: string[];
          terminal_reason?: string;
          error?: string;
          is_error?: boolean;
          num_turns?: number;
          total_cost_usd?: number;
          duration_ms?: number;
          usage?: Record<string, number>;
          modelUsage?: Record<string, unknown>;
          message?: { content?: Array<{ type: string; text?: string }> };
        };
        if (m.type === "system" && m.subtype === "init" && m.session_id) {
          sessionId = m.session_id;
        }
        if (m.type === "assistant" && m.message?.content) {
          sawContent = true;
          for (const block of m.message.content) {
            if (block.type === "text" && block.text) text += block.text;
          }
        }
        if (m.type === "result") {
          const usage = this.parseUsage(m);
          if (m.subtype === "success") {
            return {
              status: "ok",
              sessionId,
              text: m.result ?? text,
              usage,
              accountId,
            };
          }
          return {
            status: "error",
            sessionId,
            text,
            error: this.describeResultError(m),
            usage,
            accountId,
          };
        }
      }
      // result 메시지 없이 스트림이 끝났다 = 서브프로세스가 결과 전에 종료됨
      // (서버 종료·프로세스 kill 등). 진짜 오류가 아닌 '중단'으로 구분한다.
      // 단, 내용 없이 조기 종료 + resume 사용 중이면 폴백 대상이므로 throw.
      if (!sawContent && resumeInFlight) {
        throw new Error("결과 없이 스트림이 조기 종료되었습니다.");
      }
      return {
        status: "error",
        sessionId,
        text,
        error: "에이전트가 결과를 반환하기 전에 실행이 중단되었습니다.",
        interrupted: true,
      };
    };

    // resume 시도 → 내용 전 실패 시 새 세션 재시도(이미지 첨부도 동일 경로).
    const resume = opts.resume;
    try {
      return await runOnce(resume);
    } catch (err) {
      // 알 수 없는 세션 resume은 CLI 서브프로세스를 exit 1로 죽인다(init 직후 예외).
      // 내용을 아직 못 받았으면 resume 없이 새 세션으로 재시도.
      if (resume && !sawContent) {
        this.logger.warn(
          `resume(${resume}) 실패 — 새 세션으로 재시도: ${String(err)}`,
        );
        resumeInFlight = false;
        text = "";
        try {
          return await runOnce(undefined);
        } catch (err2) {
          this.logger.error(`재시도 실패: ${String(err2)}`);
          return { status: "error", sessionId, text, error: String(err2) };
        }
      }
      this.logger.error(`에이전트 실행 오류: ${String(err)}`);
      return { status: "error", sessionId, text, error: String(err) };
    }
  }
}
