import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, registerAndLogin, auth } from "./helpers";

describe("ClaudeAccount (e2e)", () => {
  let app: INestApplication;
  let token: string;
  const ids: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    ({ token } = await registerAndLogin(app));
  });
  afterAll(async () => {
    for (const id of ids)
      await request(app.getHttpServer())
        .delete(`/api/claude-accounts/${id}`)
        .set("Authorization", auth(token));
    await app.close();
  });

  it("잘못된 토큰 → 400", async () => {
    await request(app.getHttpServer())
      .post("/api/claude-accounts")
      .set("Authorization", auth(token))
      .send({ token: "not-a-token" })
      .expect(400);
  });

  it("유효 형식 토큰 추가 → 201 (첫 계정 활성, 평문 미노출)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/claude-accounts")
      .set("Authorization", auth(token))
      .send({ token: "sk-ant-oat01-E2ESECRETVALUE", label: "첫계정" })
      .expect(201);
    ids.push(res.body.id);
    expect(res.body.isActive).toBe(true);
    expect(res.body.tokenPreview.endsWith("…")).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("E2ESECRETVALUE");
  });

  it("두번째 계정 추가 후 activate 전환", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/claude-accounts")
      .set("Authorization", auth(token))
      .send({ token: "sk-ant-oat01-SECOND" })
      .expect(201);
    ids.push(res.body.id);
    expect(res.body.isActive).toBe(false);

    await request(app.getHttpServer())
      .post(`/api/claude-accounts/${res.body.id}/activate`)
      .set("Authorization", auth(token))
      .expect(201);

    const list = await request(app.getHttpServer())
      .get("/api/claude-accounts")
      .set("Authorization", auth(token))
      .expect(200);
    const active = list.body.filter(
      (a: { isActive: boolean }) => a.isActive,
    );
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(res.body.id);
  });
});
