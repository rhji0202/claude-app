import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

/** 이슈 실행 진행/상태 변화 이벤트(SSE로 흘려보냄). */
export interface IssueEvent {
  issueId: string;
  projectId: string;
  /**
   * - status: 상태 전환(claim/finish 등). 목록 새로고침 트리거.
   * - progress: 진행 한 줄 갱신(도구 호출 등). 상세 타임라인용.
   */
  type: "status" | "progress";
  /** status일 때의 새 상태(queued/running/done/...). progress면 생략. */
  status?: string;
  /** progress일 때의 진행 요약 한 줄. */
  progress?: string | null;
  /** progress일 때의 최근 이벤트(도구명 등). */
  tool?: string | null;
}

/**
 * 이슈 실행 이벤트 인프로세스 버스(설계 개선: 폴링→SSE).
 *
 * 백그라운드 워커(executeClaimed)가 진행/상태를 publish하고, SSE 컨트롤러가 구독해
 * 연결된 클라이언트로 흘려보낸다. 단일 프로세스(in-process) 전제 — 스케일아웃 시
 * Redis pub/sub 등으로 교체 필요(채팅 SSE와 동일 제약).
 */
@Injectable()
export class IssueEventsService {
  private readonly emitter = new EventEmitter();

  constructor() {
    // 구독자가 많아도 경고가 안 뜨도록(연결 수만큼 리스너). 기본 10 → 넉넉히.
    this.emitter.setMaxListeners(0);
  }

  /** 이벤트 발행(실패해도 실행에 영향 없도록 호출측에서 try 없이 안전). */
  publish(event: IssueEvent): void {
    this.emitter.emit("issue", event);
  }

  /** 구독. 반환된 함수를 호출하면 해제된다(SSE 연결 종료 시). */
  subscribe(listener: (event: IssueEvent) => void): () => void {
    this.emitter.on("issue", listener);
    return () => this.emitter.off("issue", listener);
  }
}
