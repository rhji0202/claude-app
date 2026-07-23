import { Badge, type BadgeProps } from "@/components/ui/badge";

/** 상태 문자열 → Badge variant 매핑 (queued/running/done|ok/error/interrupted) */
const VARIANT: Record<string, BadgeProps["variant"]> = {
  queued: "muted",
  running: "warning",
  done: "success",
  ok: "success",
  error: "destructive",
  interrupted: "muted",
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
