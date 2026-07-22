import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, registerAndLogin, auth } from "./helpers";

describe("Projects (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let projectId: string;

  beforeAll(async () => {
    app = await createTestApp();
    ({ token } = await registerAndLogin(app));
  });
  afterAll(async () => {
    if (projectId)
      await request(app.getHttpServer())
        .delete(`/api/projects/${projectId}`)
        .set("Authorization", auth(token));
    await app.close();
  });

  it("비인증 목록 → 401", async () => {
    await request(app.getHttpServer()).get("/api/projects").expect(401);
  });

  it("축소된 필드셋으로 생성 → 201", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Authorization", auth(token))
      .send({ name: "e2e-proj", cwd: "/tmp/e2e-proj", gitRepo: "o/r" })
      .expect(201);
    projectId = res.body.id;
    expect(res.body).not.toHaveProperty("model");
    expect(res.body).not.toHaveProperty("allowedTools");
    expect(res.body.secrets).toEqual({ hasGitToken: false });
  });

  it("제거된 필드(model) 전송 → 400", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Authorization", auth(token))
      .send({ name: "x", cwd: "/tmp/x", model: "claude-sonnet-5" })
      .expect(400);
    expect(JSON.stringify(res.body.message)).toContain("model");
  });

  it("목록/상세 조회", async () => {
    const list = await request(app.getHttpServer())
      .get("/api/projects")
      .set("Authorization", auth(token))
      .expect(200);
    expect(list.body.some((p: { id: string }) => p.id === projectId)).toBe(true);

    await request(app.getHttpServer())
      .get(`/api/projects/${projectId}`)
      .set("Authorization", auth(token))
      .expect(200);
  });

  it("공유 안 된 다른 사용자는 접근 불가 → 403", async () => {
    const other = await registerAndLogin(app);
    await request(app.getHttpServer())
      .get(`/api/projects/${projectId}`)
      .set("Authorization", auth(other.token))
      .expect(403);
  });

  it("claudeAccountId 지정 프로젝트 생성 → 저장/응답", async () => {
    // 계정 하나 연결
    const acc = await request(app.getHttpServer())
      .post("/api/claude-accounts")
      .set("Authorization", auth(token))
      .send({ token: "sk-ant-oat01-PROJSEL", label: "proj-account" })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Authorization", auth(token))
      .send({
        name: "with-account",
        cwd: "/tmp/with-account",
        claudeAccountId: acc.body.id,
      })
      .expect(201);
    expect(res.body.claudeAccountId).toBe(acc.body.id);

    await request(app.getHttpServer())
      .delete(`/api/projects/${res.body.id}`)
      .set("Authorization", auth(token));
    await request(app.getHttpServer())
      .delete(`/api/claude-accounts/${acc.body.id}`)
      .set("Authorization", auth(token));
  });

  it("남의 계정 id 지정 → 403", async () => {
    const other = await registerAndLogin(app);
    const acc = await request(app.getHttpServer())
      .post("/api/claude-accounts")
      .set("Authorization", auth(other.token))
      .send({ token: "sk-ant-oat01-OTHERS" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/projects")
      .set("Authorization", auth(token))
      .send({ name: "x", cwd: "/tmp/x", claudeAccountId: acc.body.id })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/claude-accounts/${acc.body.id}`)
      .set("Authorization", auth(other.token));
  });
});
