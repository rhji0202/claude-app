import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { McpServer as PrismaMcp, McpType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { McpServer as McpDto, McpServerType } from "@claude-app/shared";
import { CreateMcpServerDto, UpdateMcpServerDto } from "./mcp.dto";

const T_TO_PRISMA: Record<McpServerType, McpType> = {
  stdio: McpType.STDIO,
  http: McpType.HTTP,
  sse: McpType.SSE,
};
const T_TO_DTO: Record<McpType, McpServerType> = {
  STDIO: "stdio",
  HTTP: "http",
  SSE: "sse",
};
const toType = (t: McpServerType): McpType => T_TO_PRISMA[t];
const fromType = (t: McpType): McpServerType => T_TO_DTO[t];

@Injectable()
export class McpService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(m: PrismaMcp): McpDto {
    const env = (m.env as Record<string, string> | null) ?? undefined;
    return {
      id: m.id,
      name: m.name,
      type: fromType(m.type),
      command: m.command,
      args: m.args,
      url: m.url,
      envKeys: env ? Object.keys(env) : [],
      enabled: m.enabled,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }

  private validate(type: McpServerType, command?: string, url?: string): void {
    if (type === "stdio" && !command)
      throw new BadRequestException("stdio 타입은 command가 필요합니다.");
    if ((type === "http" || type === "sse") && !url)
      throw new BadRequestException("http/sse 타입은 url이 필요합니다.");
  }

  async list(): Promise<McpDto[]> {
    const rows = await this.prisma.mcpServer.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string): Promise<McpDto> {
    const row = await this.prisma.mcpServer.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("MCP 서버를 찾을 수 없습니다.");
    return this.toDto(row);
  }

  async create(dto: CreateMcpServerDto): Promise<McpDto> {
    this.validate(dto.type, dto.command, dto.url);
    const row = await this.prisma.mcpServer.create({
      data: {
        name: dto.name,
        type: toType(dto.type),
        command: dto.command,
        args: dto.args ?? [],
        url: dto.url,
        env: (dto.env ?? undefined) as Prisma.InputJsonValue | undefined,
        enabled: dto.enabled ?? true,
      },
    });
    return this.toDto(row);
  }

  async update(id: string, dto: UpdateMcpServerDto): Promise<McpDto> {
    const existing = await this.get(id);
    this.validate(dto.type ?? existing.type, dto.command, dto.url);
    const row = await this.prisma.mcpServer.update({
      where: { id },
      data: {
        name: dto.name,
        type: dto.type ? toType(dto.type) : undefined,
        command: dto.command,
        args: dto.args,
        url: dto.url,
        env: (dto.env ?? undefined) as Prisma.InputJsonValue | undefined,
        enabled: dto.enabled,
      },
    });
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.prisma.mcpServer.delete({ where: { id } });
  }
}
