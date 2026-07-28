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
import { NotifyModule } from "./notify/notify.module";
import { UsageModule } from "./usage/usage.module";
import { AgentModule } from "./agent/agent.module";
import { GithubModule } from "./github/github.module";
import { ProjectsModule } from "./projects/projects.module";
import { IssuesModule } from "./issues/issues.module";
// GitHub Issue 뷰어 — IssuesModule과 완전 분리된 별도 기능
// (docs/rules/github-issue-separation.md)
import { GhIssuesModule } from "./gh-issues/gh-issues.module";
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
    NotifyModule,
    UsageModule,
    AuthModule,
    AdminModule,
    ClaudeAccountModule,
    AgentModule,
    GithubModule,
    ProjectsModule,
    IssuesModule,
    GhIssuesModule,
    CronModule,
    SkillsModule,
    McpModule,
    ShareModule,
    ChatModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
