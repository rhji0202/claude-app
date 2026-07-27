import { Badge, type BadgeProps } from "@/components/ui/badge";

/** 상태 문자열 → Badge variant 매핑 (실행 상태 + triage 카테고리) */
const VARIANT: Record<string, BadgeProps["variant"]> = {
  draft: "muted",
  queued: "muted",
  running: "warning",
  done: "success",
  ok: "success",
  error: "destructive",
  interrupted: "muted",
  needs_decision: "warning",
  // triage 카테고리
  "auto-fix": "success",
  "needs-decision": "warning",
  "needs-info": "warning",
  question: "muted",
};

export function StatusBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  return (
    <Badge variant={VARIANT[status] ?? "muted"}>{label ?? status}</Badge>
  );
}

export function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs text-muted-foreground">{children}</span>
  );
}
