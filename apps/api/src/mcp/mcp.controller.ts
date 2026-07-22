import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { McpService } from "./mcp.service";
import { CreateMcpServerDto, UpdateMcpServerDto } from "./mcp.dto";

@Controller("mcp")
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Get() list() {
    return this.mcp.list();
  }
  @Post() create(@Body() dto: CreateMcpServerDto) {
    return this.mcp.create(dto);
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.mcp.get(id);
  }
  @Patch(":id") update(@Param("id") id: string, @Body() dto: UpdateMcpServerDto) {
    return this.mcp.update(id, dto);
  }
  @Delete(":id") async remove(@Param("id") id: string) {
    await this.mcp.remove(id);
    return { ok: true };
  }
}
