import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { CronStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AgentService } from "../agent/agent.service";

/**
 * 사용자 정의 크론 작업을 런타임에 등록/해제한다.
 * @Cron() 데코레이터(정적)가 아니라 SchedulerRegistry로 DB의 작업을 동적 관리하며,
 * 부팅 시 활성 작업을 복원한다. (기존 node-cron 워커 프로세스를 대체)
 */
@Injectable()
export class CronRegistryService implements OnModuleInit {
  private readonly logger = new Logger(CronRegistryService.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly prisma: PrismaService,
    private readonly agent: AgentService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const jobs = await this.prisma.cronJob.findMany({ where: { enabled: true } });
      for (const j of jobs) this.register(j.id, j.schedule);
      this.logger.log(`크론 작업 ${jobs.length}개 복원 완료`);
    } catch (err) {
      this.logger.warn(`크론 복원 건너뜀(DB 미가동?): ${String(err)}`);
    }
  }

  register(id: string, schedule: string): void {
    this.remove(id);
    const job = CronJob.from({
      cronTime: schedule,
      onTick: () => {
        void this.fire(id);
      },
      start: true,
    });
    this.registry.addCronJob(id, job as never);
    this.logger.log(`크론 등록: ${id} → ${schedule}`);
  }

  remove(id: string): void {
    try {
      this.registry.deleteCronJob(id);
      this.logger.log(`크론 해제: ${id}`);
    } catch {
      /* 등록돼 있지 않음 */
    }
  }

  update(id: string, schedule: string, enabled: boolean): void {
    this.remove(id);
    if (enabled) this.register(id, schedule);
  }

  /** 크론 작업을 즉시 실행 (에이전트 호출 + 결과 기록) */
  async fire(id: string): Promise<void> {
    const job = await this.prisma.cronJob.findUnique({
      where: { id },
      include: { project: { select: { ownerId: true } } },
    });
    if (!job) return;
    this.logger.log(`크론 실행: ${job.name} (${id})`);
    const res = await this.agent.run(job.projectId, {
      prompt: job.prompt,
      userId: job.project.ownerId ?? undefined,
      systemPrompt: "당신은 정기 작업을 수행하는 자동화 에이전트입니다.",
    });
    await this.prisma.cronJob.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        lastStatus: res.status === "ok" ? CronStatus.OK : CronStatus.ERROR,
        lastResult: res.status === "ok" ? res.text : res.error,
      },
    });
  }
}
