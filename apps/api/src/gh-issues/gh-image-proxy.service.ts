import { ForbiddenException, HttpException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * GitHub 이슈 본문·코멘트의 첨부 이미지를 서버가 대신 받아오는 프록시.
 *
 * GitHub 첨부(`user-attachments`)는 인증을 요구하므로 브라우저가 <img>로 직접
 * 열면 404/403이 난다. 그래서 서버가 프로젝트 토큰으로 받아 스트리밍한다.
 *
 * <img>는 Authorization 헤더를 실을 수 없으므로 접근 제어는 **서명 URL**로 한다.
 * 인증된 응답(이슈/코멘트 DTO)에서만 서명 URL을 발급하므로 무인증 열람이 막힌다.
 * (`/uploads` 정적 서빙과 같은 방식 — 다만 규칙에 따라 코드는 공유하지 않는다.
 *  docs/rules/github-issue-separation.md)
 *
 * ⚠️ 절대 규칙 — 에이전트 이슈 큐(UploadsService·IssuesService)와 분리된 전용 구현.
 */

/** 서명 URL 유효기간(ms). */
const SIGNED_URL_TTL_MS = 60 * 60 * 1000; // 1h

/** 프록시 응답 크기 상한. 초과분은 잘라내지 않고 거부한다. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25MB

export interface ProxiedImage {
  body: Buffer;
  contentType: string;
}

@Injectable()
export class GhImageProxyService {
  private readonly logger = new Logger(GhImageProxyService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * 프록시를 태울 이미지 호스트인지 검사한다(SSRF 방지 화이트리스트).
   * GitHub 첨부·콘텐츠 도메인만 허용한다.
   */
  static isProxyableUrl(raw: string): boolean {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "github.com" || host.endsWith(".githubusercontent.com");
  }

  /**
   * 마크다운/HTML 본문에서 이미지 URL을 추출한다.
   * `![alt](url)` 와 `<img src="url">` 모두 대상.
   */
  static extractImageUrls(body: string | null | undefined): string[] {
    if (!body) return [];
    const urls = new Set<string>();
    const patterns = [
      /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g,
      /<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(body))) urls.add(m[1]);
    }
    return [...urls];
  }

  private signingKey(): string {
    const key = this.config.get<string>("ENCRYPTION_KEY");
    if (!key) throw new Error("ENCRYPTION_KEY가 설정되지 않았습니다.");
    return key;
  }

  private hmac(projectId: string, url: string, exp: number): string {
    return createHmac("sha256", this.signingKey())
      .update(`${projectId}|${url}|${exp}`)
      .digest("hex");
  }

  /**
   * 원본 이미지 URL → 서명된 프록시 경로(API 프리픽스 제외한 상대 경로).
   * 웹에서 API_BASE를 앞에 붙여 <img src>로 쓴다.
   */
  signUrl(projectId: string, imageUrl: string, ttlMs = SIGNED_URL_TTL_MS): string {
    const exp = Date.now() + ttlMs;
    const sig = this.hmac(projectId, imageUrl, exp);
    const u = Buffer.from(imageUrl, "utf8").toString("base64url");
    return `/gh-issues/${projectId}/image?u=${u}&exp=${exp}&sig=${sig}`;
  }

  /**
   * 본문에 등장하는 프록시 가능 이미지 URL의 매핑을 만든다.
   * `{ 원본 URL: 서명된 프록시 경로 }` — 프론트가 src를 갈아끼우는 데 쓴다.
   */
  buildImageMap(projectId: string, body: string | null): Record<string, string> {
    const map: Record<string, string> = {};
    for (const url of GhImageProxyService.extractImageUrls(body)) {
      if (GhImageProxyService.isProxyableUrl(url)) {
        map[url] = this.signUrl(projectId, url);
      }
    }
    return map;
  }

  /** base64url로 인코딩된 `u` 파라미터를 원본 URL로 되돌린다. */
  decodeUrlParam(u: string): string {
    return Buffer.from(u, "base64url").toString("utf8");
  }

  /** 서명 검증(만료 + timing-safe 비교). */
  verify(projectId: string, imageUrl: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Date.now()) return false;
    const expected = this.hmac(projectId, imageUrl, exp);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * GitHub에서 이미지를 받아온다. 프로젝트 토큰이 있으면 붙인다
   * (비공개 첨부는 토큰이 있어야 200이 온다).
   *
   * GitHub은 보통 서명된 스토리지 URL로 리다이렉트하며, fetch 스펙상
   * 크로스오리진 리다이렉트에서는 Authorization 헤더가 제거되므로 토큰이 새지 않는다.
   */
  async fetchImage(imageUrl: string, token: string | null): Promise<ProxiedImage> {
    if (!GhImageProxyService.isProxyableUrl(imageUrl)) {
      throw new ForbiddenException("허용되지 않은 이미지 주소입니다.");
    }

    const headers: Record<string, string> = {
      Accept: "image/*,*/*;q=0.8",
      "User-Agent": "claude-app-gh-issues",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(imageUrl, { headers, redirect: "follow" });
    if (!res.ok) {
      this.logger.warn(`이미지 프록시 실패 ${res.status}: ${imageUrl}`);
      throw new HttpException(`이미지를 가져오지 못했습니다 (${res.status})`, 502);
    }

    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      throw new HttpException("이미지가 너무 큽니다.", 413);
    }

    const body = Buffer.from(await res.arrayBuffer());
    if (body.byteLength > MAX_IMAGE_BYTES) {
      throw new HttpException("이미지가 너무 큽니다.", 413);
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    // 이미지가 아니면(로그인 페이지 HTML 등) 그대로 흘리지 않는다.
    if (!contentType.startsWith("image/")) {
      throw new HttpException("이미지 응답이 아닙니다.", 502);
    }
    return { body, contentType };
  }
}
