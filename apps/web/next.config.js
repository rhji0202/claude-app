/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 워크스페이스 공유 패키지(타입 전용)를 Next가 트랜스파일하도록 허용
  transpilePackages: ["@claude-app/shared"],
};

module.exports = nextConfig;
