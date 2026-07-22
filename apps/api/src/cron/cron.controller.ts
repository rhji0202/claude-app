import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CronService } from "./cron.service";
import { CreateCronJobDto, UpdateCronJobDto } from "./cron.dto";

@Controller("cron")
export class CronController {
  constructor(private readonly cron: CronService) {}

  @Get() list() {
    return this.cron.list();
  }
  @Post() create(@Body() dto: CreateCronJobDto) {
    return this.cron.create(dto);
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.cron.get(id);
  }
  @Patch(":id") update(@Param("id") id: string, @Body() dto: UpdateCronJobDto) {
    return this.cron.update(id, dto);
  }
  @Delete(":id") async remove(@Param("id") id: string) {
    await this.cron.remove(id);
    return { ok: true };
  }

  /** 즉시 실행: POST /api/cron/:id/run */
  @Post(":id/run") runNow(@Param("id") id: string) {
    return this.cron.runNow(id);
  }
}
