import { Module } from "@nestjs/common";
import { ShareService } from "./share.service";
import { ShareController } from "./share.controller";
import { ProjectsModule } from "../projects/projects.module";
import { IssuesModule } from "../issues/issues.module";

@Module({
  imports: [ProjectsModule, IssuesModule],
  providers: [ShareService],
  controllers: [ShareController],
})
export class ShareModule {}
