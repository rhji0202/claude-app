import { Module } from "@nestjs/common";
import { IssuesService } from "./issues.service";
import { IssuesController } from "./issues.controller";
import { AgentModule } from "../agent/agent.module";
import { GithubModule } from "../github/github.module";
import { ProjectsModule } from "../projects/projects.module";

@Module({
  imports: [AgentModule, GithubModule, ProjectsModule],
  providers: [IssuesService],
  controllers: [IssuesController],
  exports: [IssuesService],
})
export class IssuesModule {}
