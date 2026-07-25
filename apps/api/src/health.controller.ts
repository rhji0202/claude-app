import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "./auth/public.decorator";
import { PrismaService } from "./prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** 라이브니스: 프로세스가 응답하는지만 확인(의존성 미검사). */
  @Public()
  @Get()
  check() {
    return { status: "ok", service: "claude-management-api" };
  }

  /**
   * 레디니스: DB 연결까지 확인. 실패 시 503 → 로드밸런서/오케스트레이터가
   * 트래픽을 보내지 않거나 재시작하도록 한다. (헬스체크가 DB 다운을 못 잡던 문제 해소)
   */
  @Public()
  @Get("ready")
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: "error", db: "down" });
    }
    return { status: "ok", db: "up" };
  }
}
