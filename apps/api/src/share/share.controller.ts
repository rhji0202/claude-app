import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ShareService } from "./share.service";
import { AddShareDto, CreateShareLinkDto, ReportIssueDto } from "./share.dto";
import { MAX_IMAGE_BYTES } from "../uploads/uploads.service";
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

  /**
   * 본문에 이미지를 붙여넣을 때 필요한 업로드 대상(초안 이슈)을 미리 만든다.
   * 초안은 DRAFT 상태라 워커가 집지 않고, 목록에도 노출되지 않는다.
   */
  @Public()
  @Post("public/share/:token/issue-drafts")
  createReportDraft(@Param("token") token: string) {
    return this.share.createReportDraft(token);
  }

  /** 테스터: 등록한 이슈에 이미지 첨부 (multipart field: files) */
  @Public()
  @Post("public/share/:token/issues/:issueId/images")
  @UseInterceptors(
    FilesInterceptor("files", 10, { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  reportImages(
    @Param("token") token: string,
    @Param("issueId") issueId: string,
    @UploadedFiles() files: Array<{ buffer: Buffer; mimetype: string }>,
  ) {
    return this.share.addReportImages(token, issueId, files ?? []);
  }
}
