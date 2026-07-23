import { Global, Module } from "@nestjs/common";
import { UploadsService } from "./uploads.service";

// 이슈/공유 모듈 등 여러 곳에서 쓰므로 전역 제공
@Global()
@Module({
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
