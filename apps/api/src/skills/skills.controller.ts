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

@Controller("skills")
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get() list() {
    return this.skills.list();
  }
  @Post() create(@Body() dto: CreateSkillDto) {
    return this.skills.create(dto);
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.skills.get(id);
  }
  @Patch(":id") update(@Param("id") id: string, @Body() dto: UpdateSkillDto) {
    return this.skills.update(id, dto);
  }
  @Delete(":id") async remove(@Param("id") id: string) {
    await this.skills.remove(id);
    return { ok: true };
  }
}
