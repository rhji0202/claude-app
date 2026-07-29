import type { Response } from "express";
import { ChatController } from "./chat.controller";
import type { ChatService } from "./chat.service";
import type { AgentControl } from "../agent/agent.service";
import type { AuthUser } from "../auth/current-user.decorator";

/**
 * SSE 스트리밍 응답의 중단 배선 검증.
 *
 * 핵심: 클라이언트가 연결을 끊으면(esc → fetch abort) interrupt()를 호출해야 한다.
 * abort(서브프로세스 kill)와 달리 interrupt는 턴만 끊어 부분 응답이 보존되므로,
 * 에이전트 실행 자체는 계속되어 저장까지 마쳐야 한다.
 */
describe("ChatController.sendMessage (SSE 중단 배선)", () => {
  const user = { userId: "u1" } as AuthUser;

  /** res.on("close") 핸들러를 잡아둘 수 있는 가짜 Response. */
  function fakeRes() {
    const writes: string[] = [];
    const handlers: Record<string, () => void> = {};
    let ended = false;
    const res = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((chunk: string) => {
        writes.push(chunk);
        return true;
      }),
      end: jest.fn(() => {
        ended = true;
      }),
      // 컨트롤러는 res.on을 체이닝하지 않으므로 반환값은 불필요(자기참조 타입 회피).
      on: jest.fn((ev: string, fn: () => void) => {
        handlers[ev] = fn;
      }),
    };
    return {
      res: res as unknown as Response,
      writes,
      close: () => handlers.close?.(),
      isEnded: () => ended,
      /** data: 프레임만(하트비트·주석 제외) */
      dataFrames: () => writes.filter((w) => w.startsWith("data:")),
    };
  }

  /** 제어 핸들만 갖는 가짜 AgentControl. */
  function fakeControl(): AgentControl & { interrupt: jest.Mock } {
    return {
      interrupt: jest.fn().mockResolvedValue(undefined),
      setModel: jest.fn(),
      supportedCommands: jest.fn(),
      getContextUsage: jest.fn(),
    } as unknown as AgentControl & { interrupt: jest.Mock };
  }

  afterEach(() => jest.useRealTimers());

  it("연결이 끊기면 interrupt()를 호출한다", async () => {
    const control = fakeControl();
    const f = fakeRes();
    let closeNow: () => void = () => {};

    const chat = {
      streamMessage: jest.fn(
        async (
          _u: string,
          _s: string,
          _p: string,
          onEvent: (e: unknown) => void,
          onControl?: (c: AgentControl) => void,
        ) => {
          onControl?.(control);
          onEvent({ type: "text_delta", id: "1:0", delta: "안" });
          // 이 시점에 사용자가 esc → 연결 종료
          closeNow();
          // 에이전트는 계속 진행해 done까지 낸다(부분 응답 저장 경로)
          onEvent({ type: "done", text: "안" });
        },
      ),
    } as unknown as ChatService;

    const controller = new ChatController(chat);
    closeNow = f.close;
    await controller.sendMessage("s1", { prompt: "hi" }, user, f.res);

    expect(control.interrupt).toHaveBeenCalledTimes(1);
  });

  it("연결이 끊긴 뒤에는 더 이상 write하지 않는다", async () => {
    const control = fakeControl();
    const f = fakeRes();
    let closeNow: () => void = () => {};

    const chat = {
      streamMessage: jest.fn(
        async (
          _u: string,
          _s: string,
          _p: string,
          onEvent: (e: unknown) => void,
          onControl?: (c: AgentControl) => void,
        ) => {
          onControl?.(control);
          onEvent({ type: "text_delta", id: "1:0", delta: "before" });
          closeNow();
          onEvent({ type: "text_delta", id: "1:0", delta: "after" });
          onEvent({ type: "done", text: "before" });
        },
      ),
    } as unknown as ChatService;

    const controller = new ChatController(chat);
    closeNow = f.close;
    await controller.sendMessage("s1", { prompt: "hi" }, user, f.res);

    const frames = f.dataFrames().join("");
    expect(frames).toContain("before");
    expect(frames).not.toContain("after");
    // 이미 끊긴 응답에 end()를 다시 부르지 않는다
    expect(f.isEnded()).toBe(false);
  });

  it("정상 완료면 interrupt 없이 응답을 닫는다", async () => {
    const control = fakeControl();
    const f = fakeRes();

    const chat = {
      streamMessage: jest.fn(
        async (
          _u: string,
          _s: string,
          _p: string,
          onEvent: (e: unknown) => void,
          onControl?: (c: AgentControl) => void,
        ) => {
          onControl?.(control);
          onEvent({ type: "done", text: "완료" });
        },
      ),
    } as unknown as ChatService;

    const controller = new ChatController(chat);
    await controller.sendMessage("s1", { prompt: "hi" }, user, f.res);

    expect(control.interrupt).not.toHaveBeenCalled();
    expect(f.isEnded()).toBe(true);
  });

  it("실행이 이미 끝난 뒤 연결이 끊겨도 예외로 번지지 않는다", async () => {
    const control = fakeControl();
    control.interrupt.mockRejectedValue(new Error("이미 종료됨"));
    const f = fakeRes();

    const chat = {
      streamMessage: jest.fn(
        async (
          _u: string,
          _s: string,
          _p: string,
          onEvent: (e: unknown) => void,
          onControl?: (c: AgentControl) => void,
        ) => {
          onControl?.(control);
          onEvent({ type: "done", text: "완료" });
        },
      ),
    } as unknown as ChatService;

    const controller = new ChatController(chat);
    await controller.sendMessage("s1", { prompt: "hi" }, user, f.res);
    // 응답이 닫힌 뒤 close 이벤트가 늦게 도착하는 경우
    expect(() => f.close()).not.toThrow();
  });

  it("하트비트 타이머를 정리한다(누수 방지)", async () => {
    jest.useFakeTimers();
    const f = fakeRes();
    const chat = {
      streamMessage: jest.fn(
        async (_u: string, _s: string, _p: string, onEvent: (e: unknown) => void) => {
          onEvent({ type: "done", text: "완료" });
        },
      ),
    } as unknown as ChatService;

    const controller = new ChatController(chat);
    await controller.sendMessage("s1", { prompt: "hi" }, user, f.res);

    const before = f.writes.length;
    jest.advanceTimersByTime(60000);
    // 정리됐으면 ping이 더 쌓이지 않는다
    expect(f.writes.length).toBe(before);
  });
});
