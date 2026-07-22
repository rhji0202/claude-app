import { Module } from "@nestjs/common";
import { CronService } from "./cron.service";
import { CronController } from "./cron.controller";
import { CronRegistryService } from "./cron-registry.service";
import { AgentModule } from "../agent/agent.module";
import { ProjectsModule } from "../projects/projects.module";

@Module({
  imports: [AgentModule, ProjectsModule],
  providers: [CronService, CronRegistryService],
  controllers: [CronController],
  exports: [CronService],
})
export class CronModule {}
