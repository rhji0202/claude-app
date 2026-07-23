import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { AgentModule } from "../agent/agent.module";
import { ProjectsModule } from "../projects/projects.module";
import { RepoModule } from "../repo/repo.module";

@Module({
  imports: [AgentModule, ProjectsModule, RepoModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
