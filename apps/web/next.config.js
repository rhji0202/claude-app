const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 워크스페이스 공유 패키지(타입 전용)를 Next가 트랜스파일하도록 허용
  transpilePackages: ["@claude-app/shared"],
  // Docker 배포용 슬림 산출물. 모노레포이므로 트레이싱 루트를 저장소 루트로 지정.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

module.exports = nextConfig;
