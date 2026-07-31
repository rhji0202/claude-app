import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

/** 허용 이미지 MIME → 확장자 */
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * 이미지가 아닌 첨부 파일의 허용 확장자.
 * 에이전트가 worktree에서 직접 열어보는 자료 파일을 받는다.
 *
 * 코딩 에이전트인 만큼 코드·스크립트 파일(sh·ps1 포함)도 받는다. 스크립트를
 * 배제해도 방어 효과는 없다 — 에이전트는 이미 bypassPermissions로 돌아 bash로
 * 임의 스크립트를 직접 만들어 실행할 수 있으므로, 첨부만 막는 것은 사용성만
 * 해치는 반쪽 조치였다. 다만 컴파일된 실행물(exe·dll·so 등)은 계속 제외한다 —
 * 내용을 읽어 검토할 수 없어 참고 자료로서의 의미가 없다.
 */
const ALLOWED_FILE_EXTS = new Set([
  // 문서·데이터
  "pdf",
  "xlsx",
  "xls",
  "csv",
  "docx",
  "doc",
  "pptx",
  "ppt",
  "txt",
  "md",
  "json",
  "xml",
  "yaml",
  "yml",
  "log",
  "zip",
  "toml",
  "ini",
  "env",
  // 코드
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sql",
  "html",
  "css",
  "scss",
  // 스크립트·패치
  "sh",
  "ps1",
  "diff",
  "patch",
]);
/** 엑셀·PDF는 이미지보다 크므로 별도 상한을 둔다. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB

/** 서명 URL 기본 유효기간(ms). 이 시간 내에서만 /uploads 접근 허용. */
const SIGNED_URL_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * 실행 시 첨부를 복사해 넣는 작업 디렉터리 하위 폴더명.
 * 이슈·채팅이 같은 규칙을 쓰므로 여기 한 곳에서만 정의한다.
 */
export const ATTACHMENT_DIR = "첨부파일";

@Injectable()
export class UploadsService {
  /** 업로드 루트. 기본 apps/api/uploads (env UPLOADS_DIR로 override) */
  readonly root =
    process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");

  constructor(private readonly config: ConfigService) {}

  private issueDir(issueId: string): string {
    return path.join("issue-images", issueId);
  }

  private chatDir(sessionId: string): string {
    return path.join("chat-files", sessionId);
  }

  /** HMAC 키(ENCRYPTION_KEY 파생). 부팅 시 env 검증으로 항상 존재. */
  private signingKey(): string {
    const key = this.config.get<string>("ENCRYPTION_KEY");
    if (!key) throw new Error("ENCRYPTION_KEY가 설정되지 않았습니다.");
    return key;
  }

  private hmac(relPath: string, exp: number): string {
    return createHmac("sha256", this.signingKey())
      .update(`${relPath}|${exp}`)
      .digest("hex");
  }

  /**
   * 이미지 상대경로에 만료(exp)+HMAC 서명(sig) 쿼리를 붙여 반환.
   * 정적 /uploads 미들웨어가 이 값을 검증하므로, 인증된 응답(이슈 DTO)에서만
   * 서명 URL을 내려보내 무인증 열람을 차단한다. relPath는 항상 posix 슬래시.
   */
  signRelPath(relPath: string, ttlMs = SIGNED_URL_TTL_MS): string {
    const exp = Date.now() + ttlMs;
    const sig = this.hmac(relPath, exp);
    return `${relPath}?exp=${exp}&sig=${sig}`;
  }

  /**
   * 서명 검증. relPath(쿼리 제외)와 exp·sig가 일치하고 미만료면 true.
   * timing-safe 비교로 서명 위조를 막는다.
   */
  verifySignature(relPath: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Date.now()) return false;
    const expected = this.hmac(relPath, exp);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** MIME 화이트리스트 검증 후 media_type 반환 (SDK image block용) */
  mediaTypeOf(mime: string): string {
    const m = mime.toLowerCase().split(";")[0].trim();
    if (!MIME_EXT[m])
      throw new BadRequestException(
        `지원하지 않는 이미지 형식입니다: ${mime} (png/jpeg/gif/webp만 허용)`,
      );
    return m;
  }

  /**
   * 이슈 이미지 버퍼를 저장하고 상대경로 반환.
   * 파일명은 UUID로 재생성(경로 traversal·충돌 방지).
   */
  async save(
    issueId: string,
    buffer: Buffer,
    mime: string,
  ): Promise<{ relPath: string; mediaType: string }> {
    return this.saveImageIn(this.issueDir(issueId), buffer, mime);
  }

  /** 채팅 세션에 이미지 첨부. 저장 규칙은 이슈와 동일하고 디렉터리만 다르다. */
  async saveChatImage(
    sessionId: string,
    buffer: Buffer,
    mime: string,
  ): Promise<{ relPath: string; mediaType: string }> {
    return this.saveImageIn(this.chatDir(sessionId), buffer, mime);
  }

  private async saveImageIn(
    dir: string,
    buffer: Buffer,
    mime: string,
  ): Promise<{ relPath: string; mediaType: string }> {
    if (buffer.length > MAX_IMAGE_BYTES)
      throw new BadRequestException("이미지 크기가 10MB를 초과합니다.");
    const mediaType = this.mediaTypeOf(mime);
    const ext = MIME_EXT[mediaType];
    const rel = path.join(dir, `${randomUUID()}.${ext}`);
    const abs = path.join(this.root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer);
    // 상대경로는 항상 posix 슬래시로 저장(웹 URL·크로스플랫폼 일관)
    return { relPath: rel.split(path.sep).join("/"), mediaType };
  }

  /**
   * 이미지가 아닌 첨부 파일을 저장하고 상대경로 + 정리된 원본 파일명을 반환.
   * 저장명은 UUID(traversal·충돌 방지)지만 확장자는 유지해 형식을 알 수 있게 한다.
   */
  async saveFile(
    issueId: string,
    buffer: Buffer,
    originalName: string,
  ): Promise<{ relPath: string; fileName: string }> {
    return this.saveFileIn(this.issueDir(issueId), buffer, originalName);
  }

  /** 채팅 세션에 이미지가 아닌 파일 첨부. 검증 규칙은 이슈와 동일. */
  async saveChatFile(
    sessionId: string,
    buffer: Buffer,
    originalName: string,
  ): Promise<{ relPath: string; fileName: string }> {
    return this.saveFileIn(this.chatDir(sessionId), buffer, originalName);
  }

  private async saveFileIn(
    dir: string,
    buffer: Buffer,
    originalName: string,
  ): Promise<{ relPath: string; fileName: string }> {
    if (buffer.length > MAX_FILE_BYTES)
      throw new BadRequestException("파일 크기가 25MB를 초과합니다.");
    // 경로 성분을 버리고 파일명만 취한다(../ 등 traversal 차단).
    const base = path.basename(originalName || "file").trim();
    const ext = path.extname(base).slice(1).toLowerCase();
    if (!ALLOWED_FILE_EXTS.has(ext))
      throw new BadRequestException(
        `지원하지 않는 파일 형식입니다: ${ext || "(확장자 없음)"} ` +
          `(${[...ALLOWED_FILE_EXTS].join("/")}만 허용)`,
      );
    const rel = path.join(dir, `${randomUUID()}.${ext}`);
    const abs = path.join(this.root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer);
    return {
      relPath: rel.split(path.sep).join("/"),
      // 표시·복사용 이름. 경로 구분자·공백을 밑줄로 바꿔 경로에서 안전하게 만든다.
      fileName: base.replace(/[^\w.가-힣-]+/g, "_"),
    };
  }

  /** 저장된 첨부 파일을 버퍼로 읽는다(worktree 복사용). */
  async readFile(relPath: string): Promise<Buffer> {
    return fs.readFile(this.absPath(relPath));
  }

  /**
   * 첨부를 실행 디렉터리의 `첨부파일/`로 복사하고 담긴 파일명 목록을 반환한다.
   * 에이전트가 자기 도구로 직접 열어볼 수 있게 하는 용도이며, 이슈·채팅이 공유한다.
   *
   * - 이름이 겹치면 앞에 순번을 붙여 덮어쓰기를 막는다(인덱스라 항상 유일).
   * - 디렉터리째 .gitignore로 제외한다 — 참고 자료가 커밋·PR에 섞이지 않게.
   * - 복사 실패는 실행을 막지 않는다(그 파일만 건너뛴다). 호출측이 로그를 남기고
   *   싶으면 onError로 받는다.
   */
  async stageInto(
    cwd: string,
    files: Array<{ relPath: string; name: string }>,
    onError?: (relPath: string, err: unknown) => void,
  ): Promise<string[]> {
    if (files.length === 0) return [];
    const dir = path.join(cwd, ATTACHMENT_DIR);
    await fs.mkdir(dir, { recursive: true }).catch(() => undefined);
    await fs
      .writeFile(path.join(dir, ".gitignore"), "*\n")
      .catch(() => undefined);
    const staged: string[] = [];
    const used = new Set<string>();
    for (const [i, f] of files.entries()) {
      const name = used.has(f.name) ? `${i + 1}_${f.name}` : f.name;
      used.add(name);
      try {
        await fs.writeFile(path.join(dir, name), await this.readFile(f.relPath));
        staged.push(name);
      } catch (err) {
        onError?.(f.relPath, err);
      }
    }
    return staged;
  }

  absPath(relPath: string): string {
    return path.join(this.root, relPath);
  }

  /** 저장된 이미지를 base64로 읽어 SDK image block 형태로 반환 */
  async readAsBase64(
    relPath: string,
  ): Promise<{ data: string; mediaType: string }> {
    const abs = this.absPath(relPath);
    const buf = await fs.readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const mediaType =
      Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? "image/png";
    return { data: buf.toString("base64"), mediaType };
  }

  /**
   * 원격 URL(GitHub 첨부 등)을 다운로드해 저장. 이미지가 아니거나 실패 시 null.
   * headers로 git 토큰 인증 부착 가능.
   */
  async downloadAndSave(
    issueId: string,
    url: string,
    headers: Record<string, string> = {},
  ): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const mime = res.headers.get("content-type") ?? "";
      if (!MIME_EXT[mime.toLowerCase().split(";")[0].trim()]) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) return null;
      const { relPath } = await this.save(issueId, buf, mime);
      return relPath;
    } catch {
      return null;
    }
  }

  /** 이슈 이미지 디렉토리 삭제(이슈 삭제 시) */
  async removeIssueDir(issueId: string): Promise<void> {
    const abs = path.join(this.root, this.issueDir(issueId));
    await fs.rm(abs, { recursive: true, force: true }).catch(() => {});
  }

  /** 채팅 세션 첨부 디렉토리 삭제(세션 삭제 시) */
  async removeChatDir(sessionId: string): Promise<void> {
    const abs = path.join(this.root, this.chatDir(sessionId));
    await fs.rm(abs, { recursive: true, force: true }).catch(() => {});
  }
}
