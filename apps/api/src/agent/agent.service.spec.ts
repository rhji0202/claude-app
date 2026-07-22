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
) => Promise<Record<string, string | undefined>>;

describe("AgentService.buildEnv (자격증명 라우팅)", () => {
  let service: AgentService;
  let config: { get: jest.Mock };
  let accounts: { getActiveToken: jest.Mock; getTokenById: jest.Mock };

  function buildEnv(
    userId: string | undefined,
    gitToken: string | null,
    claudeAccountId?: string | null,
  ) {
    return (service as unknown as { buildEnv: BuildEnv }).buildEnv(
      userId,
      gitToken,
      claudeAccountId,
    );
  }

  beforeEach(() => {
    config = { get: jest.fn().mockReturnValue(undefined) };
    accounts = {
      getActiveToken: jest.fn().mockResolvedValue(null),
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
    const env = await buildEnv("u1", null);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-ACTIVE");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("활성 계정 없으면 .env ANTHROPIC_OAUTH_TOKEN 폴백", async () => {
    accounts.getActiveToken.mockResolvedValue(null);
    config.get.mockImplementation((k: string) =>
      k === "ANTHROPIC_OAUTH_TOKEN" ? "sk-ant-oat01-FALLBACK" : undefined,
    );
    const env = await buildEnv("u1", null);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-FALLBACK");
  });

  it("일반 API 키(sk-ant-api…)는 ANTHROPIC_API_KEY로, OAuth 제거", async () => {
    accounts.getActiveToken.mockResolvedValue("sk-ant-api03-KEY");
    const env = await buildEnv("u1", null);
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-api03-KEY");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("토큰이 전혀 없으면 두 변수 모두 미설정", async () => {
    const env = await buildEnv(undefined, null);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("gitToken은 GITHUB_TOKEN·GH_TOKEN으로 주입", async () => {
    const env = await buildEnv("u1", "ghp_TOKEN");
    expect(env.GITHUB_TOKEN).toBe("ghp_TOKEN");
    expect(env.GH_TOKEN).toBe("ghp_TOKEN");
  });

  it("userId 없으면 계정 조회를 건너뛴다", async () => {
    await buildEnv(undefined, null);
    expect(accounts.getActiveToken).not.toHaveBeenCalled();
  });

  it("프로젝트 지정 계정이 활성 계정보다 우선", async () => {
    accounts.getTokenById.mockResolvedValue("sk-ant-oat01-PROJECT");
    accounts.getActiveToken.mockResolvedValue("sk-ant-oat01-ACTIVE");
    const env = await buildEnv("u1", null, "acc-1");
    expect(accounts.getTokenById).toHaveBeenCalledWith("acc-1");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-PROJECT");
    // 지정 계정이 있으면 활성 계정은 조회조차 안 함
    expect(accounts.getActiveToken).not.toHaveBeenCalled();
  });

  it("프로젝트 지정 계정 토큰이 없으면 활성 계정으로 폴백", async () => {
    accounts.getTokenById.mockResolvedValue(null);
    accounts.getActiveToken.mockResolvedValue("sk-ant-oat01-ACTIVE");
    const env = await buildEnv("u1", null, "acc-gone");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-ACTIVE");
  });
});
