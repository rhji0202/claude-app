import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
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

@Injectable()
export class UploadsService {
  /** 업로드 루트. 기본 apps/api/uploads (env UPLOADS_DIR로 override) */
  readonly root =
    process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");

  private issueDir(issueId: string): string {
    return path.join("issue-images", issueId);
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
    if (buffer.length > MAX_IMAGE_BYTES)
      throw new BadRequestException("이미지 크기가 10MB를 초과합니다.");
    const mediaType = this.mediaTypeOf(mime);
    const ext = MIME_EXT[mediaType];
    const rel = path.join(this.issueDir(issueId), `${randomUUID()}.${ext}`);
    const abs = path.join(this.root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buffer);
    // 상대경로는 항상 posix 슬래시로 저장(웹 URL·크로스플랫폼 일관)
    return { relPath: rel.split(path.sep).join("/"), mediaType };
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
}
