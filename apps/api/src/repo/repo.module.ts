import { Module } from "@nestjs/common";
import { RepoManagerService } from "./repo-manager.service";
import { WorktreeService } from "./worktree.service";
import { GithubModule } from "../github/github.module";

/**
 * 시스템 관리 clone(RepoManager) + per-run worktree 격리(Worktree).
 * 이슈 워커·크론이 gitRepo 기반 실행 격리에 사용한다.
 */
@Module({
  imports: [GithubModule],
  providers: [RepoManagerService, WorktreeService],
  exports: [RepoManagerService, WorktreeService],
})
export class RepoModule {}
