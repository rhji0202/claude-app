import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, registerAndLogin, auth } from "./helpers";

describe("Admin users (e2e)", () => {
  let app: INestApplication;
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    ({ token: adminToken } = await registerAndLogin(app, "admin"));
    ({ token: memberToken } = await registerAndLogin(app, "member"));
  });
  afterAll(async () => {
    await app.close();
  });

  it("MEMBER는 GET /api/admin/users → 403", async () => {
    await request(app.getHttpServer())
      .get("/api/admin/users")
      .set("Authorization", auth(memberToken))
      .expect(403);
  });

  it("비인증 → 401", async () => {
    await request(app.getHttpServer()).get("/api/admin/users").expect(401);
  });

  it("ADMIN은 목록 조회 → 200, passwordHash 미노출", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/admin/users")
      .set("Authorization", auth(adminToken))
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("ADMIN이 사용자 생성 → 새 계정 로그인 가능", async () => {
    const email = `created-${Date.now()}@test.local`;
    await request(app.getHttpServer())
      .post("/api/admin/users")
      .set("Authorization", auth(adminToken))
      .send({ email, password: "password123", name: "생성됨" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: "password123" })
      .expect(201);
  });

  it("비활성화한 사용자는 로그인 거부", async () => {
    const email = `todisable-${Date.now()}@test.local`;
    const created = await request(app.getHttpServer())
      .post("/api/admin/users")
      .set("Authorization", auth(adminToken))
      .send({ email, password: "password123" })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/admin/users/${created.body.id}`)
      .set("Authorization", auth(adminToken))
      .send({ disabled: true })
      .expect(200);
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: "password123" })
      .expect(401);
  });
});
