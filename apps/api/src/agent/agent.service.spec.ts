import { ConfigService } from "@nestjs/config";
import { AgentService } from "./agent.service";
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
  type Msg = { subtype?: string; error?: string; num_turns?: number };
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

  it("명시적 error가 있으면 그대로 사용", () => {
    expect(describe_({ error: "권한 거부됨", subtype: "whatever" })).toBe(
      "권한 거부됨",
    );
  });

  it("error_max_turns는 턴 수를 포함", () => {
    expect(describe_({ subtype: "error_max_turns", num_turns: 20 })).toContain(
      "20턴",
    );
  });

  it("알 수 없는 subtype은 문구에 그대로 노출", () => {
    expect(describe_({ subtype: "error_weird" })).toContain("error_weird");
  });

  it("subtype·error 모두 없으면 unknown으로 표기", () => {
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
