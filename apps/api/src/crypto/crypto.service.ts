import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * 필드 단위 암호화 (AES-256-GCM).
 * 저장 형식: v1:<iv base64>:<authTag base64>:<ciphertext base64>
 * 버전 프리픽스로 향후 키 로테이션이 가능하다.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;
  private readonly ALG = "aes-256-gcm";
  private readonly VERSION = "v1";

  constructor(config: ConfigService) {
    const raw = config.get<string>("ENCRYPTION_KEY") ?? "";
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new Error(
        "ENCRYPTION_KEY는 base64로 인코딩된 32바이트여야 합니다. (openssl rand -base64 32)",
      );
    }
    this.key = key;
  }

  /** 평문을 암호화해 저장 문자열로 반환 */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.ALG, this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      this.VERSION,
      iv.toString("base64"),
      tag.toString("base64"),
      ct.toString("base64"),
    ].join(":");
  }

  /** 저장 문자열을 복호화. 형식이 잘못되면 예외. */
  decrypt(stored: string): string {
    const parts = stored.split(":");
    if (parts.length !== 4 || parts[0] !== this.VERSION) {
      throw new Error("암호문 형식이 올바르지 않습니다.");
    }
    const [, ivB64, tagB64, ctB64] = parts;
    const decipher = createDecipheriv(
      this.ALG,
      this.key,
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  /** null/빈 값을 안전하게 처리하는 헬퍼 */
  encryptOptional(plain: string | null | undefined): string | null {
    if (!plain) return null;
    return this.encrypt(plain);
  }

  decryptOptional(stored: string | null | undefined): string | null {
    if (!stored) return null;
    try {
      return this.decrypt(stored);
    } catch (err) {
      this.logger.error(`복호화 실패: ${String(err)}`);
      return null;
    }
  }
}
