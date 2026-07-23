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
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";

@Controller("cron")
export class CronController {
  constructor(private readonly cron: CronService) {}

  @Get() list(@CurrentUser() user: AuthUser) {
    return this.cron.list(user.userId);
  }
  @Post() create(@Body() dto: CreateCronJobDto, @CurrentUser() user: AuthUser) {
    return this.cron.create(dto, user.userId);
  }
  @Get(":id") get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.cron.get(id, user.userId);
  }
  @Patch(":id") update(
    @Param("id") id: string,
    @Body() dto: UpdateCronJobDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cron.update(id, dto, user.userId);
  }
  @Delete(":id") async remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    await this.cron.remove(id, user.userId);
    return { ok: true };
  }
  @Get(":id/runs") runs(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.cron.listRuns(id, user.userId);
  }
  @Post(":id/run") runNow(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.cron.runNow(id, user.userId);
  }
}
