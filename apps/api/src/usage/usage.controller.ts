import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import type { UsageGroupBy, UsageSummary } from "@claude-app/shared";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { UsageService } from "./usage.service";
import { ProjectsService } from "../projects/projects.service";

const GROUP_BY: UsageGroupBy[] = ["day", "project", "account", "model", "kind"];

@Controller("usage")
export class UsageController {
  constructor(
    private readonly usage: UsageService,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * 사용량 집계. 접근 가능한 프로젝트로 스코프.
   * from/to는 ISO 날짜(미지정 시 최근 30일), groupBy 기본 day.
   */
  @Get("summary")
  async summary(
    @CurrentUser() user: AuthUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("groupBy") groupBy?: string,
  ): Promise<UsageSummary> {
    const gb: UsageGroupBy = GROUP_BY.includes(groupBy as UsageGroupBy)
      ? (groupBy as UsageGroupBy)
      : "day";

    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()))
      throw new BadRequestException("from/to 날짜 형식이 올바르지 않습니다.");

    const projectIds = await this.projects.accessibleProjectIds(user.userId);
    return this.usage.summary({
      projectIds,
      from: fromDate,
      to: toDate,
      groupBy: gb,
    });
  }
}
