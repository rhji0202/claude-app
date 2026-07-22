import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, registerAndLogin, auth } from "./helpers";

describe("Auth (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let email: string;

  beforeAll(async () => {
    app = await createTestApp();
    ({ token, email } = await registerAndLogin(app));
  });
  afterAll(async () => {
    await app.close();
  });

  it("자가 회원가입은 닫힘: POST /api/auth/register → 404", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "new@test.local", password: "password123" })
      .expect(404);
  });

  it("login 성공 → 201 (role 포함)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: "password123" })
      .expect(201);
    expect(res.body.user.role).toBe("member");
    expect(res.body.user).not.toHaveProperty("passwordHash");
  });

  it("login 실패(잘못된 비번) → 401", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email, password: "wrong" })
      .expect(401);
  });

  it("GET /api/auth/me 인증 → 200", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", auth(token))
      .expect(200);
    expect(res.body.email).toBe(email);
  });

  it("GET /api/auth/me 비인증 → 401", async () => {
    await request(app.getHttpServer()).get("/api/auth/me").expect(401);
  });

  it("PATCH /api/auth/me 이름 변경 → 반영", async () => {
    const res = await request(app.getHttpServer())
      .patch("/api/auth/me")
      .set("Authorization", auth(token))
      .send({ name: "새이름" })
      .expect(200);
    expect(res.body.name).toBe("새이름");
  });
});
