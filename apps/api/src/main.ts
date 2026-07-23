import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import * as path from "node:path";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 이슈 첨부 이미지 정적 서빙 (/uploads/...). UUID 파일명이라 열람 URL 추측 어려움.
  const uploadsDir =
    process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
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

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  new Logger("Bootstrap").log(`API listening on http://localhost:${port}/api`);
}

bootstrap();
