import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../src/app.module";
import { AgentService, type AgentStreamEvent } from "../src/agent/agent.service";
import { RepoManagerService } from "../src/repo/repo-manager.service";
import { PrismaService } from "../src/prisma/prisma.service";

/** 실제 Anthropic 호출을 막기 위한 AgentService mock */
export const agentMock = {
  run: jest.fn().mockResolvedValue({
    status: "ok",
    sessionId: "test-sdk-session",
    text: "mocked",
  }),
  runStream: jest
    .fn()
    .mockImplementation(
      async (
        _pid: string,
        _opts: unknown,
        onEvent: (e: AgentStreamEvent) => void,
      ) => {
        onEvent({ type: "session", sessionId: "test-sdk-session" });
        // 중간 발화 턴
        onEvent({ type: "text_start", id: "1:0" });
        onEvent({ type: "text_delta", id: "1:0", delta: "확인" });
        onEvent({ type: "text_end", id: "1:0", text: "확인하겠습니다" });
        onEvent({ type: "tool", id: "c1", name: "Bash", input: '{"command":"gh"}' });
        // 최종 답변 턴
        onEvent({ type: "text_start", id: "2:0" });
        onEvent({ type: "text_delta", id: "2:0", delta: "hello " });
        onEvent({ type: "text_delta", id: "2:0", delta: "world" });
        onEvent({ type: "text_end", id: "2:0", text: "hello world" });
        onEvent({ type: "done", text: "hello world", sessionId: "test-sdk-session" });
      },
    ),
};

/**
 * 실제 git clone/fetch를 막기 위한 RepoManagerService mock.
 * 실행 경로는 관리 clone 경로를 요구하므로(설계 12.5) 이 경계를 막지 않으면
 * e2e가 네트워크·디스크에 의존하게 된다. AgentService와 같은 이유의 mock이다.
 */
export const repoMock = {
  prepareForProject: jest.fn().mockResolvedValue("/tmp/e2e-managed-clone"),
  ensureRepo: jest.fn().mockResolvedValue("/tmp/e2e-managed-clone"),
  baseDir: jest.fn().mockReturnValue("/tmp/e2e-managed-clone"),
  defaultBranch: jest.fn().mockResolvedValue("main"),
  invalidate: jest.fn().mockResolvedValue(undefined),
  withProjectLock: jest
    .fn()
    .mockImplementation((_pid: string, fn: () => unknown) => fn()),
};

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(AgentService)
    .useValue(agentMock)
    .overrideProvider(RepoManagerService)
    .useValue(repoMock)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  return app;
}

let userCounter = 0;

/**
 * 고유 이메일 유저를 DB에 직접 만들고(자가 회원가입이 닫혀 있으므로) 로그인해 토큰 반환.
 * role="admin"으로 관리자 유저 생성 가능.
 */
export async function registerAndLogin(
  app: INestApplication,
  role: "admin" | "member" = "member",
): Promise<{ token: string; email: string; userId: string }> {
  const email = `e2e-${Date.now()}-${userCounter++}@test.local`;
  const prisma = app.get(PrismaService);
  const user = await prisma.user.create({
    data: {
      email,
      name: "E2E",
      passwordHash: await bcrypt.hash("password123", 10),
      role: role === "admin" ? "ADMIN" : "MEMBER",
    },
  });
  const res = await request(app.getHttpServer())
    .post("/api/auth/login")
    .send({ email, password: "password123" })
    .expect(201);
  return { token: res.body.accessToken, email, userId: user.id };
}

export const auth = (token: string) => `Bearer ${token}`;
