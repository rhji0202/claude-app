import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";

export type NotifyEvent =
  | "issue.done"
  | "issue.error"
  | "issue.pr"
  | "cron.error";

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

    // Slack/Discord/WeCom 모두 최상위 text/content 필드를 이해하도록 함께 담고,
    // 구조화 소비자를 위해 원본 payload도 포함한다.
    const text = this.formatText(payload);
    const body = JSON.stringify({
      text, // Slack incoming webhook
      content: text, // Discord
      msgtype: "text", // WeCom
      "text.content": text,
      ...payload,
    });

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
    };
    const proj = p.projectName ? `[${p.projectName}] ` : "";
    const lines = [`${icon[p.event]} ${proj}${p.title}`];
    if (p.url) lines.push(p.url);
    if (p.detail) lines.push("", p.detail.slice(0, 500));
    return lines.join("\n");
  }
}
