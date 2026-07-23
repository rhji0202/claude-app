import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { validateEnv } from "./config/env.validation";
import { PrismaModule } from "./prisma/prisma.module";
import { CryptoModule } from "./crypto/crypto.module";
import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { ClaudeAccountModule } from "./claude-account/claude-account.module";
import { UploadsModule } from "./uploads/uploads.module";
import { AgentModule } from "./agent/agent.module";
import { GithubModule } from "./github/github.module";
import { ProjectsModule } from "./projects/projects.module";
import { IssuesModule } from "./issues/issues.module";
import { CronModule } from "./cron/cron.module";
import { SkillsModule } from "./skills/skills.module";
import { McpModule } from "./mcp/mcp.module";
import { ShareModule } from "./share/share.module";
import { ChatModule } from "./chat/chat.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CryptoModule,
    UploadsModule,
    AuthModule,
    AdminModule,
    ClaudeAccountModule,
    AgentModule,
    GithubModule,
    ProjectsModule,
    IssuesModule,
    CronModule,
    SkillsModule,
    McpModule,
    ShareModule,
    ChatModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
