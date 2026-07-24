import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";

export type NotifyEvent =
  | "issue.done"
  | "issue.error"
  | "issue.pr"
  | "cron.error"
  | "budget.exceeded"
  | "budget.warning";

export interface NotifyPayload {
  event: NotifyEvent;
  /** 사람이 읽을 한 줄 요약(webhook 본문의 text로도 사용) */
  title: string;
  projectName?: string | null;
  /** 관련 링크(이슈·PR URL 등) */
  url?: string | null;
  /** 상세 텍스트(결과·오류 일부) */
  detail?: string | null;
}

/**
 * 프로젝트별 알림 webhook 발신(설계 M2/기타7 보강 · 4단계).
 *
 * Slack/Discord/WeCom 등 범용 incoming webhook에 JSON POST한다.
 * 알림은 부가 기능이므로 실패해도 절대 throw하지 않는다(호출측 실행에 영향 없음).
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** 프로젝트에 설정된 webhook으로 알림 전송. webhook 없으면 no-op. */
  async notify(projectId: string, payload: NotifyPayload): Promise<void> {
    let url: string | null;
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { notifyWebhookEnc: true, name: true },
      });
      url = this.crypto.decryptOptional(project?.notifyWebhookEnc);
      if (!url) return;
      payload = { ...payload, projectName: payload.projectName ?? project?.name };
    } catch (e) {
      this.logger.warn(`알림 대상 조회 실패 ${projectId}: ${String(e)}`);
      return;
    }

    // 대상별 payload 형식이 달라 함께 담는다.
    // - Slack incoming webhook: { text }
    // - Discord: { content }
    // - WeCom(기업위챗): { msgtype: "text", text: { content } } ← text가 객체여야 함
    // Slack의 최상위 text(문자열)와 WeCom의 text(객체)가 충돌하므로,
    // WeCom URL이면 WeCom 전용 형식만 보낸다.
    const text = this.formatText(payload);
    const isWeCom = /qyapi\.weixin\.qq\.com/i.test(url);
    const body = isWeCom
      ? JSON.stringify({ msgtype: "text", text: { content: text } })
      : JSON.stringify({ text, content: text, ...payload });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        this.logger.warn(`알림 전송 실패(${res.status}) ${projectId}`);
      }
    } catch (e) {
      this.logger.warn(`알림 전송 오류 ${projectId}: ${String(e)}`);
    }
  }

  private formatText(p: NotifyPayload): string {
    const icon: Record<NotifyEvent, string> = {
      "issue.done": "✅",
      "issue.error": "❌",
      "issue.pr": "🔀",
      "cron.error": "⏰❌",
      "budget.exceeded": "💸",
      "budget.warning": "⚠️",
    };
    const proj = p.projectName ? `[${p.projectName}] ` : "";
    const lines = [`${icon[p.event]} ${proj}${p.title}`];
    if (p.url) lines.push(p.url);
    if (p.detail) lines.push("", this.truncate(p.detail, 1000));
    return lines.join("\n");
  }

  /**
   * 알림 상세를 길이 제한하되 말이 중간에 끊기지 않게 다듬는다.
   * 한도를 넘으면 마지막 줄바꿈·문장/공백 경계에서 잘라 "…"을 붙인다.
   */
  private truncate(text: string, max: number): string {
    const t = text.trim();
    if (t.length <= max) return t;
    const head = t.slice(0, max);
    // 경계 우선순위: 줄바꿈 > 문장부호 > 공백. 너무 앞이면(절반 미만) 무시하고 하드 컷.
    const cut = Math.max(
      head.lastIndexOf("\n"),
      head.lastIndexOf(". "),
      head.lastIndexOf("다. "),
      head.lastIndexOf(" "),
    );
    return (cut > max / 2 ? head.slice(0, cut) : head).trimEnd() + "…";
  }
}
