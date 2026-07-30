import { ConfigService } from "@nestjs/config";
import { AgentService, type AgentStreamEvent } from "./agent.service";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";
import { ClaudeAccountService } from "../claude-account/claude-account.service";

/**
 * buildEnv는 private이지만 자격증명 라우팅이 핵심 로직이라
 * 테스트 seam으로 직접 호출한다. (SDK query()는 호출하지 않음)
 */
type BuildEnv = (
  userId: string | undefined,
  gitToken: string | null,
  claudeAccountId?: string | null,
  accountOwnerId?: string | null,
) => Promise<{
  env: Record<string, string | undefined>;
  accountId: string | null;
}>;

describe("AgentService.buildEnv (자격증명 라우팅)", () => {
  let service: AgentService;
  let config: { get: jest.Mock };
  let accounts: {
    getActiveToken: jest.Mock;
    getActiveAccountId: jest.Mock;
    getTokenById: jest.Mock;
  };

  function buildEnv(
    userId: string | undefined,
    gitToken: string | null,
    claudeAccountId?: string | null,
    accountOwnerId?: string | null,
  ) {
    return (service as unknown as { buildEnv: BuildEnv }).buildEnv(
      userId,
      gitToken,
      claudeAccountId,
      accountOwnerId,
    );
  }

  beforeEach(() => {
    config = { get: jest.fn().mockReturnValue(undefined) };
    accounts = {
      getActiveToken: jest.fn().mockResolvedValue(null),
      getActiveAccountId: jest.fn().mockResolvedValue(null),
      getTokenById: jest.fn().mockResolvedValue(null),
    };
    service = new AgentService(
      {} as unknown as PrismaService,
      {} as unknown as CryptoService,
      config as unknown as ConfigService,
      accounts as unknown as ClaudeAccountService,
    );
    // 원본 process.env 오염 방지: buildEnv는 {...process.env} 복사본을 반환
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  it("활성 계정의 oat 토큰 → CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY 제거", async () => {
    accounts.getActiveToken.mockResolvedValue("sk-ant-oat01-ACTIVE");
    const { env } = await buildEnv("u1", null);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-ACTIVE");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("활성 계정 없으면 .env ANTHROPIC_OAUTH_TOKEN 폴백", async () => {
    accounts.getActiveToken.mockResolvedValue(null);
    config.get.mockImplementation((k: string) =>
      k === "ANTHROPIC_OAUTH_TOKEN" ? "sk-ant-oat01-FALLBACK" : undefined,
    );
    const { env } = await buildEnv("u1", null);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-FALLBACK");
  });

  it("일반 API 키(sk-ant-api…)는 ANTHROPIC_API_KEY로, OAuth 제거", async () => {
    accounts.getActiveToken.mockResolvedValue("sk-ant-api03-KEY");
    const { env } = await buildEnv("u1", null);
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-api03-KEY");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("토큰이 전혀 없으면 두 변수 모두 미설정", async () => {
    const { env } = await buildEnv(undefined, null);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("gitToken은 GITHUB_TOKEN·GH_TOKEN으로 주입", async () => {
    const { env } = await buildEnv("u1", "ghp_TOKEN");
    expect(env.GITHUB_TOKEN).toBe("ghp_TOKEN");
    expect(env.GH_TOKEN).toBe("ghp_TOKEN");
  });

  it("userId 없으면 계정 조회를 건너뛴다", async () => {
    await buildEnv(undefined, null);
    expect(accounts.getActiveToken).not.toHaveBeenCalled();
  });

  it("프로젝트 지정 계정이 활성 계정보다 우선(소유자 id 함께 전달)", async () => {
    accounts.getTokenById.mockResolvedValue("sk-ant-oat01-PROJECT");
    accounts.getActiveToken.mockResolvedValue("sk-ant-oat01-ACTIVE");
    const { env } = await buildEnv("u1", null, "acc-1", "owner-1");
    // 소유권 재확인을 위해 기대 소유자(=프로젝트 owner) id도 함께 전달한다.
    expect(accounts.getTokenById).toHaveBeenCalledWith("acc-1", "owner-1");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-PROJECT");
    // 지정 계정이 있으면 활성 계정은 조회조차 안 함
    expect(accounts.getActiveToken).not.toHaveBeenCalled();
  });

  it("프로젝트 지정 계정 토큰이 없으면 활성 계정으로 폴백", async () => {
    accounts.getTokenById.mockResolvedValue(null);
    accounts.getActiveToken.mockResolvedValue("sk-ant-oat01-ACTIVE");
    const { env } = await buildEnv("u1", null, "acc-gone");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-ACTIVE");
  });

  // 사용량 귀속: 실제 자격증명을 제공한 계정 id를 함께 반환한다("계정 없음" 버그 방지).
  it("지정 계정 토큰이 있으면 accountId=지정 계정", async () => {
    accounts.getTokenById.mockResolvedValue("sk-ant-oat01-PROJECT");
    const { accountId } = await buildEnv("u1", null, "acc-1");
    expect(accountId).toBe("acc-1");
  });

  it("활성 계정 폴백이면 accountId=활성 계정 id (프로젝트 계정 미지정이어도 귀속)", async () => {
    accounts.getActiveToken.mockResolvedValue("sk-ant-oat01-ACTIVE");
    accounts.getActiveAccountId.mockResolvedValue("acc-active");
    const { accountId } = await buildEnv("u1", null);
    expect(accountId).toBe("acc-active");
  });

  it(".env 토큰 폴백이면 accountId=null(특정 계정에 귀속 불가)", async () => {
    config.get.mockImplementation((k: string) =>
      k === "ANTHROPIC_OAUTH_TOKEN" ? "sk-ant-oat01-FALLBACK" : undefined,
    );
    const { accountId } = await buildEnv("u1", null);
    expect(accountId).toBeNull();
  });
});

/**
 * describeResultError: SDK 비성공 result 메시지 → 사람이 읽을 오류 문구.
 * 무의미한 폴백 대신 종료 사유(subtype·턴 수)를 남기는 게 핵심.
 */
describe("AgentService.describeResultError (오류 사유 해석)", () => {
  type Msg = {
    subtype?: string;
    errors?: string[];
    terminal_reason?: string;
    error?: string;
    num_turns?: number;
  };
  let service: AgentService;

  function describe_(m: Msg) {
    return (
      service as unknown as { describeResultError: (m: Msg) => string }
    ).describeResultError(m);
  }

  beforeEach(() => {
    service = new AgentService(
      {} as unknown as PrismaService,
      {} as unknown as CryptoService,
      { get: jest.fn() } as unknown as ConfigService,
      {} as unknown as ClaudeAccountService,
    );
  });

  // SDK가 실제로 주는 필드는 errors: string[]다(단수 error는 없음).
  it("errors[]가 있으면 그 내용을 사용한다", () => {
    expect(
      describe_({ errors: ["권한 거부됨"], subtype: "error_during_execution" }),
    ).toBe("권한 거부됨");
  });

  it("errors[]가 여러 건이면 모두 합친다", () => {
    expect(describe_({ errors: ["첫째 오류", "둘째 오류"] })).toBe(
      "첫째 오류; 둘째 오류",
    );
  });

  it("errors[]가 빈 문자열만이면 subtype 폴백으로 넘어간다", () => {
    // 빈 값을 그대로 반환해 오류 문구가 사라지는 것을 막는다.
    expect(describe_({ errors: ["", "  "], subtype: "error_max_turns" })).toContain(
      "최대 턴 수",
    );
  });

  it("단수 error도 방어적으로 지원", () => {
    expect(describe_({ error: "권한 거부됨", subtype: "whatever" })).toBe(
      "권한 거부됨",
    );
  });

  it("error_max_turns는 턴 수를 포함", () => {
    expect(describe_({ subtype: "error_max_turns", num_turns: 20 })).toContain(
      "20턴",
    );
  });

  it("error_max_budget_usd는 예산 상한을 알린다", () => {
    expect(describe_({ subtype: "error_max_budget_usd" })).toContain("예산 상한");
  });

  it("error_max_structured_output_retries는 재시도 한도를 알린다", () => {
    expect(describe_({ subtype: "error_max_structured_output_retries" })).toContain(
      "재시도 한도",
    );
  });

  it("terminal_reason이 있으면 사유를 덧붙인다", () => {
    const out = describe_({
      subtype: "error_during_execution",
      terminal_reason: "prompt_too_long",
    });
    expect(out).toContain("prompt_too_long");
  });

  it("errors[]가 있으면 terminal_reason보다 우선(실제 내용이 더 유용)", () => {
    expect(
      describe_({ errors: ["구체적 오류"], terminal_reason: "api_error" }),
    ).toBe("구체적 오류");
  });

  it("알 수 없는 subtype은 문구에 그대로 노출", () => {
    expect(describe_({ subtype: "error_weird" })).toContain("error_weird");
  });

  it("subtype·errors 모두 없으면 unknown으로 표기", () => {
    expect(describe_({})).toContain("unknown");
  });
});

/**
 * parseUsage: SDK result 메시지 → AgentUsage. total_cost_usd/usage(snake)/modelUsage(camel).
 */
describe("AgentService.parseUsage (사용량 추출)", () => {
  type Msg = Record<string, unknown>;
  let service: AgentService;

  function parse(m: Msg) {
    return (
      service as unknown as {
        parseUsage: (m: Msg) => unknown;
      }
    ).parseUsage(m);
  }

  beforeEach(() => {
    service = new AgentService(
      {} as unknown as PrismaService,
      {} as unknown as CryptoService,
      { get: jest.fn() } as unknown as ConfigService,
      {} as unknown as ClaudeAccountService,
    );
  });

  it("total_cost_usd·토큰·모델을 추출한다", () => {
    const u = parse({
      total_cost_usd: 0.0123,
      num_turns: 4,
      duration_ms: 5000,
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 10,
      },
      modelUsage: { "claude-opus-4-8": { costUSD: 0.0123 } },
    }) as Record<string, unknown>;
    expect(u).toMatchObject({
      costUsd: 0.0123,
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 50,
      cacheCreationTokens: 10,
      model: "claude-opus-4-8",
      durationMs: 5000,
      numTurns: 4,
    });
  });

  it("사용량 정보가 전혀 없으면 undefined", () => {
    expect(parse({ subtype: "success", result: "hi" })).toBeUndefined();
  });

  it("modelUsage에 여러 모델이면 costUSD가 가장 큰 것을 대표 모델로", () => {
    const u = parse({
      total_cost_usd: 0.5,
      usage: { input_tokens: 1 },
      modelUsage: {
        "claude-haiku": { costUSD: 0.1 },
        "claude-opus": { costUSD: 0.4 },
      },
    }) as Record<string, unknown>;
    expect(u.model).toBe("claude-opus");
  });
});

/**
 * 모델·effort 해석. effort 미지원 모델(Haiku)에 전역 기본 effort가 흘러드는 것과,
 * 부모 env에 남은 CLAUDE_CODE_EFFORT_LEVEL이 상속되는 것을 막는지 확인한다.
 * effort 자체는 SDK Options.effort로 전달되고, env 키는 지워져야 한다.
 */
describe("AgentService.resolveModel / clearEffortEnv", () => {
  let service: AgentService;
  let config: { get: jest.Mock };
  let accounts: { getModelConfig: jest.Mock };

  type ResolveModel = (
    userId: string | undefined,
    claudeAccountId?: string | null,
  ) => Promise<{ model: string; effort: string | null }>;

  const resolveModel = (userId?: string) =>
    (service as unknown as { resolveModel: ResolveModel }).resolveModel(userId);

  const clearEffortEnv = (env: Record<string, string | undefined>) =>
    (
      service as unknown as {
        clearEffortEnv: (e: Record<string, string | undefined>) => void;
      }
    ).clearEffortEnv(env);

  beforeEach(() => {
    config = {
      get: jest.fn().mockImplementation((k: string) => {
        if (k === "ANTHROPIC_MODEL") return "claude-opus-5";
        if (k === "ANTHROPIC_EFFORT") return "high";
        return undefined;
      }),
    };
    accounts = { getModelConfig: jest.fn() };
    service = new AgentService(
      {} as unknown as PrismaService,
      {} as unknown as CryptoService,
      config as unknown as ConfigService,
      accounts as unknown as ClaudeAccountService,
    );
  });

  it("effort 미지원 모델이면 env 전역 기본으로도 폴백하지 않는다", async () => {
    accounts.getModelConfig.mockResolvedValue({
      model: "claude-haiku-4-5",
      effort: null,
      effortSupported: false,
    });
    expect(await resolveModel("u1")).toEqual({
      model: "claude-haiku-4-5",
      effort: null,
    });
  });

  it("계정 지정이 없으면 env 기본 모델·effort를 쓴다", async () => {
    accounts.getModelConfig.mockResolvedValue({
      model: null,
      effort: null,
      effortSupported: true,
    });
    expect(await resolveModel("u1")).toEqual({
      model: "claude-opus-5",
      effort: "high",
    });
  });

  it("xhigh/max도 그대로 해석한다(env 우회는 이 값을 버렸음)", async () => {
    accounts.getModelConfig.mockResolvedValue({
      model: "claude-opus-5",
      effort: "xhigh",
      effortSupported: true,
    });
    expect((await resolveModel("u1")).effort).toBe("xhigh");
  });

  it("부모 env에 상속된 CLAUDE_CODE_EFFORT_LEVEL은 항상 지운다", () => {
    // effort는 Options.effort로 전달되므로 env 키가 남아 있으면 충돌 소지가 있다.
    const env: Record<string, string | undefined> = {
      CLAUDE_CODE_EFFORT_LEVEL: "max",
    };
    clearEffortEnv(env);
    expect("CLAUDE_CODE_EFFORT_LEVEL" in env).toBe(false);
  });
});

/**
 * onQuery(제어 핸들 전달) 검증. SDK는 런타임 동적 import이므로 모듈을 목으로 바꿔
 * query()가 제어 메서드를 가진 async generator를 반환하게 만든다.
 */
jest.mock(
  "@anthropic-ai/claude-agent-sdk",
  () => ({ query: jest.fn() }),
  { virtual: true },
);

describe("AgentService.runStream — Query 제어 핸들", () => {
  let service: AgentService;
  let prisma: { project: { findUnique: jest.Mock } };
  let interrupt: jest.Mock;
  let setModel: jest.Mock;

  /** 제어 메서드를 가진 가짜 Query. 이벤트를 하나도 안 내고 result로 끝낸다. */
  function fakeQuery() {
    async function* gen() {
      yield { type: "system", subtype: "init", session_id: "sdk-1" };
      yield { type: "result", subtype: "success", result: "완료" };
    }
    return Object.assign(gen(), {
      interrupt,
      setModel,
      supportedCommands: jest.fn().mockResolvedValue([{ name: "clear" }]),
      getContextUsage: jest.fn().mockResolvedValue({ percentage: 12 }),
    });
  }

  beforeEach(async () => {
    interrupt = jest.fn().mockResolvedValue(undefined);
    setModel = jest.fn().mockResolvedValue(undefined);

    const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
      query: jest.Mock;
    };
    sdk.query.mockImplementation(() => fakeQuery());

    prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "p1",
          gitTokenEnc: null,
          claudeAccountId: null,
          ownerId: "u1",
        }),
      },
    };
    service = new AgentService(
      prisma as unknown as PrismaService,
      { decryptOptional: () => null } as unknown as CryptoService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {
        getModelConfig: jest.fn().mockResolvedValue({
          model: "claude-opus-5",
          effort: null,
          effortSupported: false,
        }),
        getActiveToken: jest.fn().mockResolvedValue(null),
        getActiveAccountId: jest.fn().mockResolvedValue(null),
        getTokenById: jest.fn().mockResolvedValue(null),
      } as unknown as ClaudeAccountService,
    );
    // 프로젝트에 연결된 MCP·스킬 조회는 이 테스트 범위 밖 — 빈 배열로 고정.
    (prisma as unknown as Record<string, unknown>).projectMcpServer = {
      findMany: jest.fn().mockResolvedValue([]),
    };
    (prisma as unknown as Record<string, unknown>).projectSkill = {
      findMany: jest.fn().mockResolvedValue([]),
    };
  });

  it("스트림이 열리면 제어 핸들을 넘긴다", async () => {
    const handles: unknown[] = [];
    await service.runStream(
      "p1",
      { prompt: "hi", cwd: "/wt", onQuery: (c) => handles.push(c) },
      () => {},
    );
    expect(handles).toHaveLength(1);
  });

  it("넘겨준 핸들의 interrupt/setModel이 SDK Query로 연결된다", async () => {
    let control: import("./agent.service").AgentControl | undefined;
    await service.runStream(
      "p1",
      { prompt: "hi", cwd: "/wt", onQuery: (c) => (control = c) },
      () => {},
    );
    await control!.interrupt();
    await control!.setModel("claude-sonnet-5");
    expect(interrupt).toHaveBeenCalled();
    expect(setModel).toHaveBeenCalledWith("claude-sonnet-5");
    await expect(control!.supportedCommands()).resolves.toEqual([
      { name: "clear" },
    ]);
  });

  it("onQuery 미지정이어도 정상 동작한다(선택 옵션)", async () => {
    const events: string[] = [];
    await service.runStream("p1", { prompt: "hi", cwd: "/wt" }, (e) =>
      events.push(e.type),
    );
    expect(events).toContain("done");
  });
});

describe("AgentService.runStream — 진행 이벤트 방출", () => {
  let service: AgentService;
  let messages: unknown[];

  /** SDK 메시지 시퀀스를 그대로 흘려보내는 가짜 Query. */
  function fakeQueryFrom(seq: unknown[]) {
    async function* gen() {
      for (const m of seq) yield m;
    }
    return Object.assign(gen(), {
      interrupt: jest.fn(),
      setModel: jest.fn(),
      supportedCommands: jest.fn(),
      getContextUsage: jest.fn(),
    });
  }

  beforeEach(async () => {
    const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
      query: jest.Mock;
    };
    sdk.query.mockImplementation(() => fakeQueryFrom(messages));

    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "p1",
          gitTokenEnc: null,
          claudeAccountId: null,
          ownerId: "u1",
        }),
      },
      projectMcpServer: { findMany: jest.fn().mockResolvedValue([]) },
      projectSkill: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new AgentService(
      prisma as unknown as PrismaService,
      { decryptOptional: () => null } as unknown as CryptoService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {
        getModelConfig: jest.fn().mockResolvedValue({
          model: "claude-opus-5",
          effort: null,
          effortSupported: false,
        }),
        getActiveToken: jest.fn().mockResolvedValue(null),
        getActiveAccountId: jest.fn().mockResolvedValue(null),
        getTokenById: jest.fn().mockResolvedValue(null),
      } as unknown as ClaudeAccountService,
    );
  });

  async function collect() {
    const out: AgentStreamEvent[] = [];
    await service.runStream("p1", { prompt: "hi", cwd: "/wt" }, (e) =>
      out.push(e),
    );
    return out;
  }

  it("tool_progress를 경과 초와 함께 방출한다", async () => {
    messages = [
      {
        type: "tool_progress",
        tool_use_id: "tu_1",
        elapsed_time_seconds: 12.7,
        parent_tool_use_id: null,
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "tool_progress", id: "tu_1", elapsedSeconds: 12.7 },
      ]),
    );
  });

  it("서브에이전트 내부 도구의 진행은 건너뛴다(대응 파트가 없음)", async () => {
    messages = [
      {
        type: "tool_progress",
        tool_use_id: "tu_child",
        elapsed_time_seconds: 5,
        parent_tool_use_id: "tu_parent",
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    expect(events.some((e) => e.type === "tool_progress")).toBe(false);
  });

  it("thinking_tokens를 방출한다", async () => {
    messages = [
      {
        type: "system",
        subtype: "thinking_tokens",
        estimated_tokens: 2048,
        estimated_tokens_delta: 128,
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    expect(events).toEqual(
      expect.arrayContaining([{ type: "thinking_tokens", tokens: 2048 }]),
    );
  });

  it("진행 이벤트만 온 뒤 result 없이 끝나면 중단으로 처리한다(내용으로 오인 금지)", async () => {
    // sawContent를 올리지 않아야 resume 폴백 판단이 깨지지 않는다.
    messages = [
      {
        type: "tool_progress",
        tool_use_id: "tu_1",
        elapsed_time_seconds: 1,
        parent_tool_use_id: null,
      },
    ];
    const events = await collect();
    expect(events.at(-1)?.type).toBe("error");
  });
});

describe("AgentService.runStream — 서브에이전트(Task) 이벤트", () => {
  let service: AgentService;
  let messages: unknown[];

  function fakeQueryFrom(seq: unknown[]) {
    async function* gen() {
      for (const m of seq) yield m;
    }
    return Object.assign(gen(), {
      interrupt: jest.fn(),
      setModel: jest.fn(),
      supportedCommands: jest.fn(),
      getContextUsage: jest.fn(),
    });
  }

  beforeEach(async () => {
    const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
      query: jest.Mock;
    };
    sdk.query.mockImplementation(() => fakeQueryFrom(messages));

    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "p1",
          gitTokenEnc: null,
          claudeAccountId: null,
          ownerId: "u1",
        }),
      },
      projectMcpServer: { findMany: jest.fn().mockResolvedValue([]) },
      projectSkill: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new AgentService(
      prisma as unknown as PrismaService,
      { decryptOptional: () => null } as unknown as CryptoService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {
        getModelConfig: jest.fn().mockResolvedValue({
          model: "claude-opus-5",
          effort: null,
          effortSupported: false,
        }),
        getActiveToken: jest.fn().mockResolvedValue(null),
        getActiveAccountId: jest.fn().mockResolvedValue(null),
        getTokenById: jest.fn().mockResolvedValue(null),
      } as unknown as ClaudeAccountService,
    );
  });

  async function collect() {
    const out: AgentStreamEvent[] = [];
    await service.runStream("p1", { prompt: "hi", cwd: "/wt" }, (e) =>
      out.push(e),
    );
    return out;
  }

  it("task_started를 agent_start로 방출한다(tool_use_id로 파트에 연결)", async () => {
    messages = [
      {
        type: "system",
        subtype: "task_started",
        task_id: "task_1",
        tool_use_id: "tu_1",
        description: "인증 모듈 분석",
        subagent_type: "Explore",
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    expect(events).toEqual(
      expect.arrayContaining([
        {
          type: "agent_start",
          id: "tu_1",
          taskId: "task_1",
          description: "인증 모듈 분석",
          agentType: "Explore",
        },
      ]),
    );
  });

  it("task_progress를 usage·summary와 함께 방출한다", async () => {
    messages = [
      {
        type: "system",
        subtype: "task_progress",
        task_id: "task_1",
        tool_use_id: "tu_1",
        description: "인증 모듈 분석",
        usage: { total_tokens: 5000, tool_uses: 7, duration_ms: 31000 },
        last_tool_name: "Grep",
        summary: "인증 흐름을 확인하는 중",
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    expect(events).toEqual(
      expect.arrayContaining([
        {
          type: "agent_progress",
          id: "tu_1",
          taskId: "task_1",
          tokens: 5000,
          toolUses: 7,
          lastToolName: "Grep",
          summary: "인증 흐름을 확인하는 중",
        },
      ]),
    );
  });

  it("tool_use_id 없는 태스크는 건너뛴다(붙일 파트가 없음)", async () => {
    messages = [
      {
        type: "system",
        subtype: "task_started",
        task_id: "task_wf",
        description: "워크플로",
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    expect(events.some((e) => e.type === "agent_start")).toBe(false);
  });

  it("서브에이전트 진행 요약 옵션을 SDK에 전달한다", async () => {
    messages = [{ type: "result", subtype: "success", result: "" }];
    await collect();
    const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
      query: jest.Mock;
    };
    expect(sdk.query.mock.calls[0][0].options).toMatchObject({
      agentProgressSummaries: true,
    });
  });
});

describe("AgentService.runStream — 재시도·사용량 한도 알림", () => {
  let service: AgentService;
  let messages: unknown[];

  function fakeQueryFrom(seq: unknown[]) {
    async function* gen() {
      for (const m of seq) yield m;
    }
    return Object.assign(gen(), {
      interrupt: jest.fn(),
      setModel: jest.fn(),
      supportedCommands: jest.fn(),
      getContextUsage: jest.fn(),
    });
  }

  beforeEach(async () => {
    const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
      query: jest.Mock;
    };
    sdk.query.mockImplementation(() => fakeQueryFrom(messages));

    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "p1",
          gitTokenEnc: null,
          claudeAccountId: null,
          ownerId: "u1",
        }),
      },
      projectMcpServer: { findMany: jest.fn().mockResolvedValue([]) },
      projectSkill: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new AgentService(
      prisma as unknown as PrismaService,
      { decryptOptional: () => null } as unknown as CryptoService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {
        getModelConfig: jest.fn().mockResolvedValue({
          model: "claude-opus-5",
          effort: null,
          effortSupported: false,
        }),
        getActiveToken: jest.fn().mockResolvedValue(null),
        getActiveAccountId: jest.fn().mockResolvedValue(null),
        getTokenById: jest.fn().mockResolvedValue(null),
      } as unknown as ClaudeAccountService,
    );
  });

  async function collect() {
    const out: AgentStreamEvent[] = [];
    await service.runStream("p1", { prompt: "hi", cwd: "/wt" }, (e) =>
      out.push(e),
    );
    return out;
  }

  it("api_retry를 시도 횟수·사유와 함께 방출한다", async () => {
    messages = [
      {
        type: "system",
        subtype: "api_retry",
        attempt: 2,
        max_retries: 3,
        retry_delay_ms: 1500,
        error: "overloaded",
        error_status: 529,
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    expect(events).toEqual(
      expect.arrayContaining([
        {
          type: "api_retry",
          attempt: 2,
          maxRetries: 3,
          delayMs: 1500,
          reason: "overloaded",
        },
      ]),
    );
  });

  it("rate_limit_event의 epoch 초를 ISO로 변환해 방출한다", async () => {
    messages = [
      {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed_warning",
          utilization: 0.91,
          resetsAt: 1800000000,
          rateLimitType: "five_hour",
        },
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    const ev = events.find((e) => e.type === "rate_limit");
    expect(ev).toMatchObject({
      status: "allowed_warning",
      utilization: 0.91,
      limitType: "five_hour",
      resetsAt: new Date(1800000000 * 1000).toISOString(),
    });
  });

  it("status=allowed인 한도 이벤트는 흘리지 않는다(알릴 게 없음)", async () => {
    messages = [
      {
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed", utilization: 0.1 },
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    expect(events.some((e) => e.type === "rate_limit")).toBe(false);
  });

  it("알림 이벤트만 온 뒤 result 없이 끝나면 중단으로 처리한다", async () => {
    // 재시도·한도 알림은 내용이 아니므로 sawContent를 올려선 안 된다.
    messages = [
      {
        type: "system",
        subtype: "api_retry",
        attempt: 1,
        max_retries: 3,
        error: "rate_limit",
      },
    ];
    const events = await collect();
    expect(events.at(-1)?.type).toBe("error");
  });
});

describe("AgentService.runStream — 서브에이전트 중첩 트랜스크립트", () => {
  let service: AgentService;
  let messages: unknown[];

  function fakeQueryFrom(seq: unknown[]) {
    async function* gen() {
      for (const m of seq) yield m;
    }
    return Object.assign(gen(), {
      interrupt: jest.fn(),
      setModel: jest.fn(),
      supportedCommands: jest.fn(),
      getContextUsage: jest.fn(),
    });
  }

  beforeEach(async () => {
    const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
      query: jest.Mock;
    };
    sdk.query.mockImplementation(() => fakeQueryFrom(messages));

    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "p1",
          gitTokenEnc: null,
          claudeAccountId: null,
          ownerId: "u1",
        }),
      },
      projectMcpServer: { findMany: jest.fn().mockResolvedValue([]) },
      projectSkill: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new AgentService(
      prisma as unknown as PrismaService,
      { decryptOptional: () => null } as unknown as CryptoService,
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {
        getModelConfig: jest.fn().mockResolvedValue({
          model: "claude-opus-5",
          effort: null,
          effortSupported: false,
        }),
        getActiveToken: jest.fn().mockResolvedValue(null),
        getActiveAccountId: jest.fn().mockResolvedValue(null),
        getTokenById: jest.fn().mockResolvedValue(null),
      } as unknown as ClaudeAccountService,
    );
  });

  async function collect() {
    const out: AgentStreamEvent[] = [];
    await service.runStream("p1", { prompt: "hi", cwd: "/wt" }, (e) =>
      out.push(e),
    );
    return out;
  }

  it("forwardSubagentText 옵션을 SDK에 전달한다", async () => {
    messages = [{ type: "result", subtype: "success", result: "" }];
    await collect();
    const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
      query: jest.Mock;
    };
    expect(sdk.query.mock.calls[0][0].options).toMatchObject({
      forwardSubagentText: true,
    });
  });

  it("서브에이전트 텍스트에 parentId를 붙여 방출한다", async () => {
    messages = [
      {
        type: "assistant",
        parent_tool_use_id: "tu_parent",
        message: { content: [{ type: "text", text: "서브 결과" }] },
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    const end = events.find((e) => e.type === "text_end");
    expect(end).toMatchObject({ text: "서브 결과", parentId: "tu_parent" });
  });

  it("메인 스레드 텍스트에는 parentId가 없다", async () => {
    messages = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "메인 답변" }] },
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    const end = events.find((e) => e.type === "text_end") as {
      parentId?: string;
    };
    expect(end.parentId).toBeUndefined();
  });

  it("같은 블록 인덱스여도 메인·서브 텍스트 id가 겹치지 않는다", async () => {
    // 같은 turn·index면 예전 규칙에서는 둘 다 "1:0" → 서로를 덮어썼다.
    messages = [
      { type: "stream_event", event: { type: "message_start" } },
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "메인" }] },
      },
      {
        type: "assistant",
        parent_tool_use_id: "tu_parent",
        message: { content: [{ type: "text", text: "서브" }] },
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    const ids = events
      .filter((e) => e.type === "text_end")
      .map((e) => (e as { id: string }).id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("서브에이전트 도구 호출·결과에도 parentId가 붙는다", async () => {
    messages = [
      {
        type: "assistant",
        parent_tool_use_id: "tu_parent",
        message: {
          content: [
            { type: "tool_use", id: "tu_child", name: "Grep", input: { pattern: "x" } },
          ],
        },
      },
      {
        type: "user",
        parent_tool_use_id: "tu_parent",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tu_child", content: "3건" },
          ],
        },
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    expect(events.find((e) => e.type === "tool")).toMatchObject({
      id: "tu_child",
      parentId: "tu_parent",
    });
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({
      id: "tu_child",
      parentId: "tu_parent",
    });
  });

  /**
   * 텍스트 세그먼트 id는 SDK assistant 메시지 id(message.id)에 묶인다.
   * 예전 규칙(`${turn}:${index}`)은 turn이 가변 카운터라, 다음 턴의
   * message_start가 앞 턴의 assistant 메시지보다 먼저 도착하면 delta와
   * text_end의 id가 갈라져 같은 답변이 두 파트로 렌더됐다(중복 출력).
   */
  it("delta와 text_end가 같은 id로 수렴한다(같은 메시지)", async () => {
    messages = [
      {
        type: "stream_event",
        event: { type: "message_start", message: { id: "msg_1" } },
      },
      {
        type: "stream_event",
        event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "안녕" },
        },
      },
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { id: "msg_1", content: [{ type: "text", text: "안녕하세요" }] },
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    const idOf = (t: string) =>
      events.filter((e) => e.type === t).map((e) => (e as { id: string }).id);
    // start는 1회만, delta와 end는 동일 id
    expect(idOf("text_start")).toHaveLength(1);
    expect(idOf("text_delta")[0]).toBe(idOf("text_start")[0]);
    expect(idOf("text_end")[0]).toBe(idOf("text_start")[0]);
  });

  it("다음 턴 message_start가 먼저 와도 텍스트 파트가 중복되지 않는다", async () => {
    // 회귀 재현: msg_1의 델타 뒤에 msg_2의 message_start가 끼어들고,
    // 그 다음 msg_1의 완결 assistant 메시지가 도착하는 순서.
    messages = [
      {
        type: "stream_event",
        event: { type: "message_start", message: { id: "msg_1" } },
      },
      {
        type: "stream_event",
        event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "부분 답변" },
        },
      },
      // 다음 턴이 열린다 — 예전 규칙에서는 여기서 turn이 2로 올라갔다.
      {
        type: "stream_event",
        event: { type: "message_start", message: { id: "msg_2" } },
      },
      // 앞 턴(msg_1)의 완결 메시지가 뒤늦게 도착.
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { id: "msg_1", content: [{ type: "text", text: "부분 답변 완성" }] },
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    // 텍스트 파트는 하나뿐이어야 한다 → text_start 1회.
    expect(events.filter((e) => e.type === "text_start")).toHaveLength(1);
    const startId = (events.find((e) => e.type === "text_start") as { id: string }).id;
    const end = events.find((e) => e.type === "text_end") as {
      id: string;
      text: string;
    };
    expect(end.id).toBe(startId);
    expect(end.text).toBe("부분 답변 완성");
  });

  it("연속된 두 턴의 텍스트는 서로 다른 파트가 된다", async () => {
    messages = [
      {
        type: "stream_event",
        event: { type: "message_start", message: { id: "msg_1" } },
      },
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { id: "msg_1", content: [{ type: "text", text: "첫 턴" }] },
      },
      {
        type: "stream_event",
        event: { type: "message_start", message: { id: "msg_2" } },
      },
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: { id: "msg_2", content: [{ type: "text", text: "둘째 턴" }] },
      },
      { type: "result", subtype: "success", result: "" },
    ];
    const events = await collect();
    const ends = events.filter((e) => e.type === "text_end") as Array<{
      id: string;
      text: string;
    }>;
    expect(ends).toHaveLength(2);
    expect(new Set(ends.map((e) => e.id)).size).toBe(2);
  });
});
