/**
 * `next build`(output: "standalone") 뒤에 정적 자산을 standalone 산출물로 복사한다.
 *
 * standalone은 server.js와 필요한 node_modules만 담고 `public/`과 `.next/static`은
 * 넣지 않는다. 그대로 띄우면 /brand/logo-mark.svg 같은 public 파일과 JS·CSS 청크가
 * 404가 난다(배포 후 사이드바 로고가 안 보였던 원인). server.js는 시작할 때 public을
 * 읽으므로, 복사 후에는 서버를 재시작해야 반영된다.
 *
 * 모노레포라 standalone 안의 앱 경로는 `.next/standalone/apps/web`이다.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(webDir, ".next", "standalone", "apps", "web");

if (!existsSync(target)) {
  console.warn(`[copy-standalone-assets] standalone 산출물이 없어 건너뜁니다: ${target}`);
  process.exit(0);
}

for (const [from, to] of [
  [join(webDir, ".next", "static"), join(target, ".next", "static")],
  [join(webDir, "public"), join(target, "public")],
]) {
  if (!existsSync(from)) continue;
  // 이전 빌드의 지워진 파일이 남지 않게 통째로 교체한다.
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`[copy-standalone-assets] ${from} → ${to}`);
}
