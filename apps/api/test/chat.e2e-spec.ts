import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, registerAndLogin, auth } from "./helpers";

describe("Chat (e2e, AgentService mock)", () => {
  let app: INestApplication;
  let token: string;
  let projectId: string;
  let sessionId: string;

  beforeAll(async () => {
    app = await createTestApp();
    ({ token } = await registerAndLogin(app));
    const proj = await request(app.getHttpServer())
      .post("/api/projects")
      .set("Authorization", auth(token))
      .send({ name: "chat-e2e", cwd: "/tmp/chat-e2e" })
      .expect(201);
    projectId = proj.body.id;
  });
  afterAll(async () => {
    if (sessionId)
      await request(app.getHttpServer())
        .delete(`/api/chat/sessions/${sessionId}`)
        .set("Authorization", auth(token));
    if (projectId)
      await request(app.getHttpServer())
        .delete(`/api/projects/${projectId}`)
        .set("Authorization", auth(token));
    await app.close();
  });

  it("세션 생성 → 201", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/chat/sessions")
      .set("Authorization", auth(token))
      .send({ projectId })
      .expect(201);
    sessionId = res.body.id;
    expect(res.body.projectId).toBe(projectId);
  });

  it("메시지 전송 → SSE 스트림(delta→done)", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/chat/sessions/${sessionId}/messages`)
      .set("Authorization", auth(token))
      .send({ prompt: "say hello" })
      .expect(201)
      .expect("Content-Type", /text\/event-stream/);

    // mock agent가 text_start/text_delta/text_end/tool/done을 흘려보냄
    expect(res.text).toContain('"type":"text_start"');
    expect(res.text).toContain('"type":"text_delta"');
    expect(res.text).toContain('"type":"text_end"');
    expect(res.text).toContain('"type":"tool"');
    expect(res.text).toContain('"type":"done"');
    expect(res.text).toContain("hello world");
  });

  it("재조회 시 user+assistant 메시지 + parts 타임라인 저장됨", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/chat/sessions/${sessionId}`)
      .set("Authorization", auth(token))
      .expect(200);
    const roles = res.body.messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(["user", "assistant"]);
    const assistant = res.body.messages[1];
    // content = 최종 답변(마지막 text 파트)
    expect(assistant.content).toBe("hello world");
    expect(res.body.title).toBe("say hello");
    // parts = 순서 있는 타임라인: 중간발화 → 도구 → 최종답변
    expect(assistant.parts).toEqual([
      { type: "text", id: "1:0", text: "확인하겠습니다" },
      { type: "tool", id: "c1", name: "Bash", input: '{"command":"gh"}' },
      { type: "text", id: "2:0", text: "hello world" },
    ]);
  });
});
