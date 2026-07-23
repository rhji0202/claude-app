import { Module } from "@nestjs/common";
import { CronService } from "./cron.service";
import { CronController } from "./cron.controller";
import { CronRegistryService } from "./cron-registry.service";
import { AgentModule } from "../agent/agent.module";
import { ProjectsModule } from "../projects/projects.module";
import { RepoModule } from "../repo/repo.module";
import { IssuesModule } from "../issues/issues.module";

@Module({
  imports: [AgentModule, ProjectsModule, RepoModule, IssuesModule],
  providers: [CronService, CronRegistryService],
  controllers: [CronController],
  exports: [CronService],
})
export class CronModule {}
