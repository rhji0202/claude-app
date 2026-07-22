import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { IssuesService } from "./issues.service";
import { CreateIssueTaskDto, UpdateIssueTaskDto } from "./issues.dto";

@Controller("issues")
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Get() list(@Query("projectId") projectId?: string) {
    return this.issues.list(projectId);
  }
  @Post() create(@Body() dto: CreateIssueTaskDto) {
    return this.issues.create(dto);
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.issues.get(id);
  }
  @Patch(":id") update(@Param("id") id: string, @Body() dto: UpdateIssueTaskDto) {
    return this.issues.update(id, dto);
  }
  @Delete(":id") async remove(@Param("id") id: string) {
    await this.issues.remove(id);
    return { ok: true };
  }
}
