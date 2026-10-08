"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { CHANGELOG, type ChangeKind } from "@/lib/changelog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const KIND: Record<ChangeKind, { label: string; variant: BadgeProps["variant"] }> = {
  new: { label: "신규", variant: "success" },
  improved: { label: "개선", variant: "default" },
  fixed: { label: "수정", variant: "warning" },
};

// 접힌 상태에서 보여줄 날짜 묶음 수.
const COLLAPSED_COUNT = 3;

export function ChangelogPanel() {
  const [expanded, setExpanded] = useState(false);
  const entries = expanded ? CHANGELOG : CHANGELOG.slice(0, COLLAPSED_COUNT);

  return (
    <Card className="mt-6">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <History className="size-4 text-accent" />
          <h2 className="text-sm font-semibold">CHANGELOG</h2>
        </div>

        <ol className="space-y-5">
          {entries.map((e) => (
            <li key={e.date} className="border-l-2 border-border pl-4">
              <time dateTime={e.date} className="text-xs font-medium tabular-nums text-muted-foreground">
                {e.date.replaceAll("-", ".")}
              </time>
              <ul className="mt-2 space-y-1.5">
                {e.changes.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                    <Badge variant={KIND[c.kind].variant} className="mt-0.5 shrink-0">
                      {KIND[c.kind].label}
                    </Badge>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        {CHANGELOG.length > COLLAPSED_COUNT && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-4 text-muted-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "접기" : `이전 변경 ${CHANGELOG.length - COLLAPSED_COUNT}건 더 보기`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
