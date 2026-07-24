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

/**
 * 앱 공통 마크다운 렌더러. streamdown을 감싸 이미지 <p> 중첩 문제를 해결한다.
 * streamdown 기본 remark 플러그인을 유지한 채 unwrap-images만 덧붙인다.
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <Streamdown
      className={className}
      remarkPlugins={[...Object.values(defaultRemarkPlugins), remarkUnwrapImages]}
    >
      {children}
    </Streamdown>
  );
}
