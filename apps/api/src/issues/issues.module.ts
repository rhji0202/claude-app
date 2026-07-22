import { Module } from "@nestjs/common";
import { IssuesService } from "./issues.service";
import { IssuesController } from "./issues.controller";
import { AgentModule } from "../agent/agent.module";
import { GithubModule } from "../github/github.module";

@Module({
  imports: [AgentModule, GithubModule],
  providers: [IssuesService],
  controllers: [IssuesController],
  exports: [IssuesService],
})
export class IssuesModule {}
