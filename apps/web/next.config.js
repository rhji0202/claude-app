const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 워크스페이스 공유 패키지를 Next가 트랜스파일하도록 허용.
  // 타입뿐 아니라 런타임 값(모델·effort 목록 등)도 공유하므로 반드시 필요하다.
  transpilePackages: ["@claude-app/shared"],
  // Docker 배포용 슬림 산출물. 모노레포이므로 트레이싱 루트를 저장소 루트로 지정.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:3001/api/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
