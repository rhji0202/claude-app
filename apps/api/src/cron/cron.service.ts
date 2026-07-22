import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CronJob as PrismaCronJob, CronStatus } from "@prisma/client";
import { CronTime } from "cron";
import { PrismaService } from "../prisma/prisma.service";
import type { CronJob as CronDto, CronStatus as CronStatusDto } from "@claude-app/shared";
import { CreateCronJobDto, UpdateCronJobDto } from "./cron.dto";

@Injectable()
export class CronService {
  constructor(private readonly prisma: PrismaService) {}

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

  private toDto(c: PrismaCronJob): CronDto {
    const status: CronStatusDto | null =
      c.lastStatus === CronStatus.OK
        ? "ok"
        : c.lastStatus === CronStatus.ERROR
          ? "error"
          : null;
    return {
      id: c.id,
      name: c.name,
      schedule: c.schedule,
      prompt: c.prompt,
      projectId: c.projectId,
      enabled: c.enabled,
      lastRunAt: c.lastRunAt ? c.lastRunAt.toISOString() : null,
      lastResult: c.lastResult,
      lastStatus: status,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  async list(): Promise<CronDto[]> {
    const rows = await this.prisma.cronJob.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string): Promise<CronDto> {
    return this.toDto(await this.getRaw(id));
  }

  async getRaw(id: string): Promise<PrismaCronJob> {
    const row = await this.prisma.cronJob.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("크론 작업을 찾을 수 없습니다.");
    return row;
  }

  async create(dto: CreateCronJobDto): Promise<CronDto> {
    CronService.validateSchedule(dto.schedule);
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
    return this.toDto(row);
  }

  async update(id: string, dto: UpdateCronJobDto): Promise<CronDto> {
    await this.getRaw(id);
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
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    await this.getRaw(id);
    await this.prisma.cronJob.delete({ where: { id } });
  }
}
