"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export type FieldType =
  | "text"
  | "number"
  | "textarea"
  | "checkbox"
  | "select"
  | "csv";

export interface OptionsFrom {
  endpoint: string;
  valueKey: string;
  labelKey: string;
}

export interface FieldDef {
  name: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  optionsFrom?: OptionsFrom;
  defaultValue?: unknown;
  full?: boolean;
}

export interface ColumnDef {
  key: string;
  label: string;
  render?: (row: Record<string, unknown>) => React.ReactNode;
}

export interface RowAction {
  label: string;
  href: (row: Record<string, unknown>) => string;
  variant?: "secondary" | "danger";
  confirm?: string;
}

export interface CrudPanelProps {
  endpoint: string;
  title: string;
  createTitle?: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  rowActions?: RowAction[];
  reloadSignal?: number;
}

type Row = Record<string, unknown> & { id: string };

export default function CrudPanel(props: CrudPanelProps) {
  const { endpoint, title, columns, fields, rowActions } = props;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    action: RowAction;
    row: Row;
  } | null>(null);
  const [dynOptions, setDynOptions] = useState<
    Record<string, { value: string; label: string }[]>
  >({});
  const [form, setForm] = useState<Record<string, unknown>>(() =>
    initialForm(fields),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Row[]>(endpoint);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    load();
  }, [load, props.reloadSignal]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, { value: string; label: string }[]> = {};
      for (const f of fields) {
        if (f.optionsFrom) {
          try {
            const data = await api.get<Record<string, unknown>[]>(
              f.optionsFrom.endpoint,
            );
            next[f.name] = data.map((d) => ({
              value: String(d[f.optionsFrom!.valueKey]),
              label: String(
                d[f.optionsFrom!.labelKey] ?? d[f.optionsFrom!.valueKey],
              ),
            }));
          } catch {
            next[f.name] = [];
          }
        }
      }
      if (!cancelled) setDynOptions(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [fields]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(endpoint, serialize(form, fields));
      setForm(initialForm(fields));
      toast.success(`${title}이(가) 추가되었습니다.`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const row = pendingDelete;
    setPendingDelete(null);
    try {
      await api.del(`${endpoint}/${row.id}`);
      toast.success("삭제되었습니다.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function triggerAction(action: RowAction, row: Row) {
    if (action.confirm) setPendingAction({ action, row });
    else void runAction(action, row);
  }

  async function runAction(action: RowAction, row: Row) {
    setBusy(true);
    try {
      await api.post(action.href(row));
      toast.success(`${action.label} 완료`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* 생성 폼 */}
      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-sm">
            {props.createTitle ?? `${title} 추가`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <FieldInput
                  key={f.name}
                  field={f}
                  value={form[f.name]}
                  options={f.optionsFrom ? dynOptions[f.name] : f.options}
                  onChange={(v) => setForm((s) => ({ ...s, [f.name]: v }))}
                />
              ))}
            </div>
            <div className="mt-4">
              <Button type="submit" disabled={busy}>
                <Plus className="size-4" />
                {busy ? "처리 중..." : "추가"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 목록 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{title} 목록</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              항목이 없습니다.
            </div>
          ) : (
            <>
              {/* 데스크톱: 테이블 (>=md) */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columns.map((c) => (
                        <TableHead key={c.key}>{c.label}</TableHead>
                      ))}
                      <TableHead className="text-right">작업</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        {columns.map((c) => (
                          <TableCell key={c.key}>
                            {c.render
                              ? c.render(row)
                              : String(row[c.key] ?? "")}
                          </TableCell>
                        ))}
                        <TableCell>
                          <RowActions
                            row={row}
                            actions={rowActions}
                            busy={busy}
                            onRun={triggerAction}
                            onDelete={() => setPendingDelete(row)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* 모바일: 카드 리스트 (<md) */}
              <div className="space-y-3 md:hidden">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-lg border border-border p-3"
                  >
                    <dl className="space-y-1.5">
                      {columns.map((c) => (
                        <div
                          key={c.key}
                          className="flex items-start justify-between gap-3 text-sm"
                        >
                          <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {c.label}
                          </dt>
                          <dd className="min-w-0 text-right">
                            {c.render
                              ? c.render(row)
                              : String(row[c.key] ?? "")}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-3 flex justify-end">
                      <RowActions
                        row={row}
                        actions={rowActions}
                        busy={busy}
                        onRun={runAction}
                        onDelete={() => setPendingDelete(row)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>삭제 확인</DialogTitle>
            <DialogDescription>
              이 항목을 삭제하시겠습니까? 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setPendingDelete(null)}
            >
              취소
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              <Trash2 className="size-4" />
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 액션 확인 다이얼로그 (rowAction.confirm) */}
      <Dialog
        open={!!pendingAction}
        onOpenChange={(o) => !o && setPendingAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingAction?.action.label} 확인</DialogTitle>
            <DialogDescription>
              {pendingAction?.action.confirm}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingAction(null)}>
              취소
            </Button>
            <Button
              onClick={() => {
                if (pendingAction)
                  void runAction(pendingAction.action, pendingAction.row);
                setPendingAction(null);
              }}
            >
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RowActions({
  row,
  actions,
  busy,
  onRun,
  onDelete,
}: {
  row: Row;
  actions?: RowAction[];
  busy: boolean;
  onRun: (action: RowAction, row: Row) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {actions?.map((a) => (
        <Button
          key={a.label}
          variant={a.variant === "danger" ? "destructive" : "secondary"}
          size="sm"
          disabled={busy}
          onClick={() => onRun(a, row)}
        >
          {a.label}
        </Button>
      ))}
      <Button variant="destructive" size="sm" onClick={onDelete}>
        <Trash2 className="size-4" />
        삭제
      </Button>
    </div>
  );
}

function FieldInput({
  field,
  value,
  options,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  options?: { value: string; label: string }[];
  onChange: (v: unknown) => void;
}) {
  const type = field.type ?? "text";
  const full = field.full || type === "textarea";
  return (
    <div className={cn("flex flex-col gap-1.5", full && "sm:col-span-2")}>
      <Label>
        {field.label}
        {field.required ? " *" : ""}
      </Label>
      {type === "textarea" ? (
        <Textarea
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : type === "checkbox" ? (
        <label className="flex h-11 items-center gap-2 md:h-9">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="text-sm text-muted-foreground">
            {field.placeholder ?? "활성화"}
          </span>
        </label>
      ) : type === "select" ? (
        <Select
          value={String(value ?? "")}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="선택..." />
          </SelectTrigger>
          <SelectContent>
            {(options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          type={type === "number" ? "number" : "text"}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function initialForm(fields: FieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    out[f.name] = f.defaultValue ?? (f.type === "checkbox" ? false : "");
  }
  return out;
}

function serialize(
  form: Record<string, unknown>,
  fields: FieldDef[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = form[f.name];
    if (f.type === "number") {
      out[f.name] = v === "" || v == null ? undefined : Number(v);
    } else if (f.type === "csv") {
      out[f.name] =
        typeof v === "string" && v.trim()
          ? v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
    } else if (f.type === "checkbox") {
      out[f.name] = Boolean(v);
    } else {
      out[f.name] = v === "" ? undefined : v;
    }
  }
  return out;
}
