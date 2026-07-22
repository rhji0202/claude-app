import { Module } from "@nestjs/common";
import { AgentService } from "./agent.service";
import { ClaudeAccountModule } from "../claude-account/claude-account.module";

@Module({
  imports: [ClaudeAccountModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
