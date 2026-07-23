"use client";

import { useRef, useState } from "react";
import { Eye, Pencil, ImagePlus } from "lucide-react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

/**
 * 마크다운 에디터: 작성/미리보기 탭 + 이미지 붙여넣기·드래그·버튼 업로드.
 * onUploadImage(file) → 저장된 이미지의 마크다운 URL을 반환하면 커서 위치에 ![](url) 삽입.
 */
export function MarkdownEditor({
  value,
  onChange,
  onUploadImage,
  placeholder,
  minRows = 5,
}: {
  value: string;
  onChange: (v: string) => void;
  onUploadImage?: (file: File) => Promise<string>;
  placeholder?: string;
  minRows?: number;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [uploading, setUploading] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  function insertAtCursor(text: string) {
    const el = ref.current;
    if (!el) {
      onChange(value + text);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    // 커서를 삽입 텍스트 뒤로
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleFiles(files: File[]) {
    if (!onUploadImage) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setUploading(true);
    try {
      for (const file of images) {
        const url = await onUploadImage(file);
        insertAtCursor(`\n![${file.name}](${url})\n`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-md border border-input">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <TabBtn active={tab === "write"} onClick={() => setTab("write")}>
          <Pencil className="size-3.5" />
          작성
        </TabBtn>
        <TabBtn active={tab === "preview"} onClick={() => setTab("preview")}>
          <Eye className="size-3.5" />
          미리보기
        </TabBtn>
        {onUploadImage && (
          <label className="ml-auto flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
            <ImagePlus className="size-3.5" />
            {uploading ? "업로드 중..." : "이미지"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>

      {tab === "write" ? (
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={minRows}
          className="rounded-none border-0 focus-visible:ring-0"
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              handleFiles(files);
            }
          }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer.files);
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              handleFiles(files);
            }
          }}
        />
      ) : (
        <div className="min-h-[120px] px-3 py-2 text-sm">
          {value ? (
            <Streamdown className="prose prose-sm max-w-none dark:prose-invert">
              {value}
            </Streamdown>
          ) : (
            <span className="text-muted-foreground">
              미리볼 내용이 없습니다.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
