import { Module } from "@nestjs/common";
import { GhIssuesService } from "./gh-issues.service";
import { GhIssuesController } from "./gh-issues.controller";
import { GhApiClient } from "./gh-api.client";
import { GhImageProxyService } from "./gh-image-proxy.service";
import { ProjectsModule } from "../projects/projects.module";

/**
 * GitHub Issue 뷰어 모듈.
 *
 * ⚠️ 절대 규칙 — IssuesModule(에이전트 이슈 큐)을 import하지 않는다.
 * 프로젝트 권한·저장소 정보를 얻기 위한 ProjectsModule만 의존한다.
 * docs/rules/github-issue-separation.md 참고.
 */
@Module({
  imports: [ProjectsModule],
  providers: [GhIssuesService, GhApiClient, GhImageProxyService],
  controllers: [GhIssuesController],
})
export class GhIssuesModule {}
