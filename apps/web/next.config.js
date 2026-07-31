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
    // 같은 오리진으로 온 /api/* 를 API 서버로 넘긴다(nginx 없이 web만 노출할 때).
    // 브라우저는 보통 NEXT_PUBLIC_API_URL로 API를 직접 호출하므로 이 경로는
    // 폴백이지만, 포트가 어긋나면 그 경로만 조용히 502가 된다.
    //
    // 포트를 박아두면 환경마다 이 파일을 고쳐야 한다(개발 6001·운영 7100처럼).
    // 실제로 서버에서 이 줄만 수정한 채 커밋되지 않고 남아 있었다.
    // API_PROXY_TARGET으로 덮어쓰고, 없으면 기존 기본값을 그대로 쓴다.
    const target = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001";
    return [
      {
        source: "/api/:path*",
        destination: `${target.replace(/\/+$/, "")}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
