import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ShareService } from "./share.service";
import { AddShareDto, CreateShareLinkDto, ReportIssueDto } from "./share.dto";
import { Public } from "../auth/public.decorator";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";

@Controller()
export class ShareController {
  constructor(private readonly share: ShareService) {}

  // ---- 팀 공유 (인증 필요) ----

  @Post("projects/:id/shares")
  addShare(
    @Param("id") id: string,
    @Body() dto: AddShareDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.share.addShare(id, user.userId, dto);
  }

  @Get("projects/:id/shares")
  listShares(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.share.listShares(id, user.userId);
  }

  @Delete("projects/:id/shares/:userId")
  removeShare(
    @Param("id") id: string,
    @Param("userId") targetUserId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.share.removeShare(id, user.userId, targetUserId);
  }

  // ---- 공유 링크 (인증 필요) ----

  @Post("projects/:id/share-links")
  createLink(
    @Param("id") id: string,
    @Body() dto: CreateShareLinkDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.share.createLink(id, user.userId, dto);
  }

  @Get("projects/:id/share-links")
  listLinks(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.share.listLinks(id, user.userId);
  }

  @Delete("share-links/:linkId")
  revokeLink(@Param("linkId") linkId: string, @CurrentUser() user: AuthUser) {
    return this.share.revokeLink(linkId, user.userId);
  }

  // ---- 공개 접근 (비로그인) ----

  @Public()
  @Get("public/share/:token")
  publicView(@Param("token") token: string) {
    return this.share.publicView(token);
  }

  @Public()
  @Post("public/share/:token/issues")
  reportIssue(@Param("token") token: string, @Body() dto: ReportIssueDto) {
    return this.share.reportIssue(token, dto);
  }
}
