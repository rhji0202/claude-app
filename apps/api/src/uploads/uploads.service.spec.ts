import { ConfigService } from "@nestjs/config";
import { UploadsService } from "./uploads.service";

/** 서명 URL(exp+sig) 발급·검증 로직만 테스트. 파일 IO는 다루지 않는다. */
describe("UploadsService 서명 URL", () => {
  function make(key = "test-encryption-key-32bytes-long!!"): UploadsService {
    const config = {
      get: (k: string) => (k === "ENCRYPTION_KEY" ? key : undefined),
    } as unknown as ConfigService;
    return new UploadsService(config);
  }

  const REL = "issue-images/abc/x.png";

  it("발급한 서명은 검증을 통과한다", () => {
    const svc = make();
    const signed = svc.signRelPath(REL);
    const [rel, qs] = signed.split("?");
    const params = new URLSearchParams(qs);
    expect(rel).toBe(REL);
    expect(
      svc.verifySignature(
        rel,
        Number(params.get("exp")),
        params.get("sig") ?? "",
      ),
    ).toBe(true);
  });

  it("만료된 서명은 거부한다", () => {
    const svc = make();
    const exp = Date.now() - 1000; // 이미 지남
    const sig = (
      svc as unknown as { hmac: (r: string, e: number) => string }
    ).hmac(REL, exp);
    expect(svc.verifySignature(REL, exp, sig)).toBe(false);
  });

  it("위조된 sig는 거부한다", () => {
    const svc = make();
    const signed = svc.signRelPath(REL);
    const params = new URLSearchParams(signed.split("?")[1]);
    expect(
      svc.verifySignature(REL, Number(params.get("exp")), "deadbeef"),
    ).toBe(false);
  });

  it("다른 키로 만든 서명은 거부한다(키 격리)", () => {
    const signer = make("key-A-32bytes-xxxxxxxxxxxxxxxxxxxx");
    const verifier = make("key-B-32bytes-yyyyyyyyyyyyyyyyyyyy");
    const params = new URLSearchParams(signer.signRelPath(REL).split("?")[1]);
    expect(
      verifier.verifySignature(
        REL,
        Number(params.get("exp")),
        params.get("sig") ?? "",
      ),
    ).toBe(false);
  });
});
