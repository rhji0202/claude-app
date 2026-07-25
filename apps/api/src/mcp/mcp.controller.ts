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
import { AdminOnly } from "../auth/admin.decorator";

// MCP 서버는 전역이며 STDIO command가 에이전트 서브프로세스(bypassPermissions)로
// 그대로 주입된다 → 생성/수정/삭제는 admin만. 조회는 프로젝트 연결(attach) UI에
// 필요하므로 인증된 멤버 모두 허용.
@Controller("mcp")
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Get() list() {
    return this.mcp.list();
  }
  @AdminOnly() @Post() create(@Body() dto: CreateMcpServerDto) {
    return this.mcp.create(dto);
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.mcp.get(id);
  }
  @AdminOnly() @Patch(":id") update(
    @Param("id") id: string,
    @Body() dto: UpdateMcpServerDto,
  ) {
    return this.mcp.update(id, dto);
  }
  @AdminOnly() @Delete(":id") async remove(@Param("id") id: string) {
    await this.mcp.remove(id);
    return { ok: true };
  }
}
