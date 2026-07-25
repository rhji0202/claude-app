import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import type { Request, Response, NextFunction } from "express";
import * as path from "node:path";
import { AppModule } from "./app.module";
import { UploadsService } from "./uploads/uploads.service";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 이슈 첨부 이미지 정적 서빙 (/uploads/...). 서명 URL(exp+sig)만 통과시킨다.
  // 서명은 인증된 응답(이슈 DTO)에서만 발급되므로 무인증 열람을 차단한다.
  const uploadsDir =
    process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
  const uploads = app.get(UploadsService);
  app.use("/uploads", (req: Request, res: Response, next: NextFunction) => {
    // originalUrl에서 /uploads 프리픽스와 쿼리스트링을 떼어 저장 relPath와 맞춘다
    // (마운트 시 req.url이 스트립돼도 originalUrl은 항상 전체 경로).
    const noQuery = req.originalUrl.split("?")[0];
    const relPath = decodeURIComponent(
      noQuery.replace(/^\/uploads\/?/, "").replace(/^\/+/, ""),
    );
    const exp = Number(req.query.exp);
    const sig = typeof req.query.sig === "string" ? req.query.sig : "";
    if (!uploads.verifySignature(relPath, exp, sig)) {
      res
        .status(403)
        .json({ statusCode: 403, message: "유효하지 않거나 만료된 이미지 링크입니다." });
      return;
    }
    next();
  });
  app.useStaticAssets(uploadsDir, { prefix: "/uploads" });

  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Next.js 프론트엔드에서의 호출 허용
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",") ?? true,
    credentials: true,
  });

  // 종료 시그널(SIGTERM/SIGINT)에 OnModuleDestroy 훅을 돌린다
  // (실행 중 이슈 에이전트 서브프로세스를 정리해 leak 방지 — IssuesService.onModuleDestroy).
  app.enableShutdownHooks();

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  new Logger("Bootstrap").log(`API listening on http://localhost:${port}/api`);
}

bootstrap();
