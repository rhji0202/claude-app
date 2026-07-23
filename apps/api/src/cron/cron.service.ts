import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CronJob as PrismaCronJob,
  CronRun as PrismaCronRun,
  CronStatus,
} from "@prisma/client";
import { CronTime } from "cron";
import { PrismaService } from "../prisma/prisma.service";
import { CronRegistryService } from "./cron-registry.service";
import { ProjectsService } from "../projects/projects.service";
import type {
  CronJob as CronDto,
  CronRun as CronRunDto,
  CronStatus as CronStatusDto,
} from "@claude-app/shared";
import { CreateCronJobDto, UpdateCronJobDto } from "./cron.dto";

const toStatusDto = (s: CronStatus | null): CronStatusDto | null =>
  s === CronStatus.OK ? "ok" : s === CronStatus.ERROR ? "error" : null;

@Injectable()
export class CronService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CronRegistryService,
    private readonly projects: ProjectsService,
  ) {}

  /** 크론식 유효성 검증 (cron 패키지 사용). 잘못되면 400. */
  static validateSchedule(schedule: string): void {
    try {
      // 유효하지 않으면 생성자에서 예외
      new CronTime(schedule);
    } catch (err) {
      throw new BadRequestException(
        `잘못된 크론식입니다: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 스케줄에서 다음 실행 예정 시각 계산(enabled일 때만). 계산 실패 시 null. */
  private nextRunAt(schedule: string, enabled: boolean): string | null {
    if (!enabled) return null;
    try {
      return new CronTime(schedule).sendAt().toISO();
    } catch {
      return null;
    }
  }

  private toDto(c: PrismaCronJob): CronDto {
    return {
      id: c.id,
      name: c.name,
      schedule: c.schedule,
      prompt: c.prompt,
      projectId: c.projectId,
      enabled: c.enabled,
      lastRunAt: c.lastRunAt ? c.lastRunAt.toISOString() : null,
      lastResult: c.lastResult,
      lastStatus: toStatusDto(c.lastStatus),
      nextRunAt: this.nextRunAt(c.schedule, c.enabled),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private runToDto(r: PrismaCronRun): CronRunDto {
    return {
      id: r.id,
      cronJobId: r.cronJobId,
      status: toStatusDto(r.status),
      result: r.result,
      error: r.error,
      sessionId: r.sessionId,
      durationMs: r.durationMs,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    };
  }

  async list(userId: string): Promise<CronDto[]> {
    const ids = await this.projects.accessibleProjectIds(userId);
    const rows = await this.prisma.cronJob.findMany({
      where: { projectId: { in: ids } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string, userId: string): Promise<CronDto> {
    const row = await this.getRaw(id);
    await this.projects.assertAccess(row.projectId, userId);
    return this.toDto(row);
  }

  async getRaw(id: string): Promise<PrismaCronJob> {
    const row = await this.prisma.cronJob.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("크론 작업을 찾을 수 없습니다.");
    return row;
  }

  async create(dto: CreateCronJobDto, userId: string): Promise<CronDto> {
    CronService.validateSchedule(dto.schedule);
    await this.projects.assertCanEdit(dto.projectId, userId);
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project) throw new BadRequestException("프로젝트를 찾을 수 없습니다.");

    const row = await this.prisma.cronJob.create({
      data: {
        name: dto.name,
        schedule: dto.schedule,
        prompt: dto.prompt,
        projectId: dto.projectId,
        enabled: dto.enabled ?? true,
      },
    });
    if (row.enabled) this.registry.register(row.id, row.schedule);
    return this.toDto(row);
  }

  async update(id: string, dto: UpdateCronJobDto, userId: string): Promise<CronDto> {
    const existing = await this.getRaw(id);
    await this.projects.assertCanEdit(existing.projectId, userId);
    if (dto.schedule) CronService.validateSchedule(dto.schedule);
    const row = await this.prisma.cronJob.update({
      where: { id },
      data: {
        name: dto.name,
        schedule: dto.schedule,
        prompt: dto.prompt,
        enabled: dto.enabled,
      },
    });
    this.registry.update(row.id, row.schedule, row.enabled);
    return this.toDto(row);
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.getRaw(id);
    await this.projects.assertCanEdit(existing.projectId, userId);
    this.registry.remove(id);
    await this.prisma.cronJob.delete({ where: { id } });
  }

  /** 즉시 실행 후 갱신된 작업 반환 */
  async runNow(id: string, userId: string): Promise<CronDto> {
    const existing = await this.getRaw(id);
    await this.projects.assertCanEdit(existing.projectId, userId);
    await this.registry.fire(id);
    return this.get(id, userId);
  }

  /** 크론 실행 이력(최근순). 접근 권한 확인 후 반환. */
  async listRuns(id: string, userId: string): Promise<CronRunDto[]> {
    const existing = await this.getRaw(id);
    await this.projects.assertAccess(existing.projectId, userId);
    const rows = await this.prisma.cronRun.findMany({
      where: { cronJobId: id },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    return rows.map((r) => this.runToDto(r));
  }
}
