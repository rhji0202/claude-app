import { Injectable, NotFoundException } from "@nestjs/common";
import { Skill as PrismaSkill, SkillScope as PrismaScope } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Skill as SkillDto, SkillScope } from "@claude-app/shared";
import { CreateSkillDto, UpdateSkillDto } from "./skills.dto";

const toScope = (s: SkillScope): PrismaScope =>
  s === "global" ? PrismaScope.GLOBAL : PrismaScope.PROJECT;
const fromScope = (s: PrismaScope): SkillScope =>
  s === PrismaScope.GLOBAL ? "global" : "project";

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(s: PrismaSkill): SkillDto {
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      content: s.content,
      scope: fromScope(s.scope),
      enabled: s.enabled,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async list(): Promise<SkillDto[]> {
    const rows = await this.prisma.skill.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string): Promise<SkillDto> {
    const row = await this.prisma.skill.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("스킬을 찾을 수 없습니다.");
    return this.toDto(row);
  }

  async create(dto: CreateSkillDto): Promise<SkillDto> {
    const row = await this.prisma.skill.create({
      data: {
        name: dto.name,
        description: dto.description,
        content: dto.content ?? "",
        scope: toScope(dto.scope ?? "project"),
        enabled: dto.enabled ?? true,
      },
    });
    return this.toDto(row);
  }

  async update(id: string, dto: UpdateSkillDto): Promise<SkillDto> {
    await this.get(id);
    const row = await this.prisma.skill.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        content: dto.content,
        scope: dto.scope ? toScope(dto.scope) : undefined,
        enabled: dto.enabled,
      },
    });
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.prisma.skill.delete({ where: { id } });
  }
}
