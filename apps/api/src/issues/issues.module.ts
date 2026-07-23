import { Module } from "@nestjs/common";
import { IssuesService } from "./issues.service";
import { IssueWorkerService } from "./issue-worker.service";
import { IssuesController } from "./issues.controller";
import { AgentModule } from "../agent/agent.module";
import { GithubModule } from "../github/github.module";
import { ProjectsModule } from "../projects/projects.module";
import { RepoModule } from "../repo/repo.module";

@Module({
  imports: [AgentModule, GithubModule, ProjectsModule, RepoModule],
  providers: [IssuesService, IssueWorkerService],
  controllers: [IssuesController],
  exports: [IssuesService],
})
export class IssuesModule {}
