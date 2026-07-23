import { Module } from "@nestjs/common";
import { ProjectsService } from "./projects.service";
import { ProjectsController } from "./projects.controller";
import { AgentModule } from "../agent/agent.module";
import { RepoModule } from "../repo/repo.module";

@Module({
  imports: [AgentModule, RepoModule],
  providers: [ProjectsService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
