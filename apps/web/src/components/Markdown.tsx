"use client";

import { Streamdown, defaultRemarkPlugins } from "streamdown";

/** mdast 노드의 최소 형태(외부 타입 의존 없이 플러그인 로직에 필요한 부분만). */
type MdNode = { type: string; children?: MdNode[] };

/**
 * 이미지-only 문단의 <p>를 제거하는 remark 플러그인.
 *
 * streamdown은 이미지를 <div>로 감싸는데, 마크다운의 `![](url)`은 문단(<p>) 안에
 * 놓이므로 <p><div>...</div></p> 형태가 되어 하이드레이션 에러가 난다.
 * (HTML에서 <div>는 <p>의 자식이 될 수 없음)
 * 이미지(및 이미지만 감싼 링크)로만 이루어진 문단을 그 자식들로 풀어헤쳐 해결한다.
 * remark-unwrap-images와 동일한 동작을 의존성 없이 구현.
 */
function remarkUnwrapImages() {
  return (tree: MdNode) => {
    const isImageOnly = (node: MdNode): boolean => {
      if (node.type === "image" || node.type === "imageReference") return true;
      // 이미지 하나만 감싼 링크도 이미지 취급(![](url) 형태 링크 대응)
      if (node.type === "link" || node.type === "linkReference") {
        return !!node.children?.length && node.children.every(isImageOnly);
      }
      return false;
    };

    const unwrap = (parent: MdNode): void => {
      if (!parent.children) return;
      const next: MdNode[] = [];
      for (const child of parent.children) {
        if (
          child.type === "paragraph" &&
          !!child.children?.length &&
          child.children.every(isImageOnly)
        ) {
          // 이미지-only 문단은 자식(이미지들)만 남기고 <p>를 제거
          next.push(...child.children);
        } else {
          unwrap(child);
          next.push(child);
        }
      }
      parent.children = next;
    };

    unwrap(tree);
  };
}

/** 인증이 필요해 브라우저에서 직접 열 수 없는 외부 이미지 호스트. */
const PRIVATE_IMAGE_HOST =
  /(user-attachments|githubusercontent\.com|github\.com\/.+\/assets\/)/;

/**
 * 앱 공통 마크다운 렌더러. streamdown을 감싸 이미지 <p> 중첩 문제를 해결한다.
 * streamdown 기본 remark 플러그인을 유지한 채 unwrap-images만 덧붙인다.
 *
 * imageMap을 넘기면 본문 이미지의 src를 로컬 업로드 URL로 치환한다.
 * GitHub 이슈 본문의 첨부 URL은 인증이 필요해 그대로 두면 403/404로 깨지는데,
 * import 시 이미 로컬로 내려받아 뒀으므로 그 경로로 바꿔치기하는 것이다.
 * 매핑에 없는 비공개 호스트 이미지는 깨진 아이콘 대신 숨긴다.
 */
export function Markdown({
  children,
  className,
  imageMap,
}: {
  children: string;
  className?: string;
  /** 원본 이미지 URL → 로컬 이미지 URL(이미 절대 URL로 변환된 값) */
  imageMap?: Record<string, string> | null;
}) {
  return (
    <Streamdown
      className={className}
      remarkPlugins={[...Object.values(defaultRemarkPlugins), remarkUnwrapImages]}
      components={{
        img: ({ src, alt, ...rest }) => {
          const original = typeof src === "string" ? src : "";
          const mapped = imageMap?.[original];
          // 매핑에 없고 인증 필요한 호스트면 렌더하지 않는다(깨진 이미지 방지).
          if (!mapped && PRIVATE_IMAGE_HOST.test(original)) return null;
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              {...rest}
              src={mapped ?? original}
              alt={alt ?? ""}
              className="max-w-full rounded-lg"
            />
          );
        },
      }}
    >
      {children}
    </Streamdown>
  );
}
