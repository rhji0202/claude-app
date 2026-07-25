import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { SkillsService } from "./skills.service";
import { CreateSkillDto, UpdateSkillDto } from "./skills.dto";
import { AdminOnly } from "../auth/admin.decorator";

// 스킬은 전역이며 content가 모든 프로젝트의 시스템 프롬프트로 결합된다
// → 생성/수정/삭제는 admin만. 조회는 프로젝트 연결(attach) UI에 필요하므로
// 인증된 멤버 모두 허용.
@Controller("skills")
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get() list() {
    return this.skills.list();
  }
  @AdminOnly() @Post() create(@Body() dto: CreateSkillDto) {
    return this.skills.create(dto);
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.skills.get(id);
  }
  @AdminOnly() @Patch(":id") update(
    @Param("id") id: string,
    @Body() dto: UpdateSkillDto,
  ) {
    return this.skills.update(id, dto);
  }
  @AdminOnly() @Delete(":id") async remove(@Param("id") id: string) {
    await this.skills.remove(id);
    return { ok: true };
  }
}
