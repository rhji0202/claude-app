"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dynOptions, setDynOptions] = useState<
    Record<string, { value: string; label: string }[]>
  >({});
  const [form, setForm] = useState<Record<string, unknown>>(() => initialForm(fields));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Row[]>(endpoint);
      setRows(Array.isArray(data) ? data : []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
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
            const data = await api.get<Record<string, unknown>[]>(f.optionsFrom.endpoint);
            next[f.name] = data.map((d) => ({
              value: String(d[f.optionsFrom!.valueKey]),
              label: String(d[f.optionsFrom!.labelKey] ?? d[f.optionsFrom!.valueKey]),
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
    setError(null);
    try {
      await api.post(endpoint, serialize(form, fields));
      setForm(initialForm(fields));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("삭제하시겠습니까?")) return;
    try {
      await api.del(`${endpoint}/${id}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runAction(action: RowAction, row: Row) {
    if (action.confirm && !confirm(action.confirm)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(action.href(row));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2>{props.createTitle ?? `${title} 추가`}</h2>
        <form onSubmit={submit}>
          <div className="form-grid">
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
          <div style={{ marginTop: 14 }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "처리 중..." : "추가"}
            </button>
          </div>
          {error && <div className="error-text">{error}</div>}
        </form>
      </div>

      <div className="card">
        <h2>{title} 목록</h2>
        {loading ? (
          <div className="empty">불러오는 중...</div>
        ) : rows.length === 0 ? (
          <div className="empty">항목이 없습니다.</div>
        ) : (
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th style={{ width: 1 }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {c.render ? c.render(row) : String(row[c.key] ?? "")}
                    </td>
                  ))}
                  <td>
                    <div className="row-actions">
                      {rowActions?.map((a) => (
                        <button
                          key={a.label}
                          className={`btn small ${a.variant ?? "secondary"}`}
                          disabled={busy}
                          onClick={() => runAction(a, row)}
                        >
                          {a.label}
                        </button>
                      ))}
                      <button className="btn small danger" onClick={() => remove(row.id)}>
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
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
  return (
    <div className={`field${field.full || type === "textarea" ? " full" : ""}`}>
      <label>
        {field.label}
        {field.required ? " *" : ""}
      </label>
      {type === "textarea" ? (
        <textarea
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : type === "checkbox" ? (
        <input
          type="checkbox"
          checked={Boolean(value)}
          style={{ width: 18, height: 18 }}
          onChange={(e) => onChange(e.target.checked)}
        />
      ) : type === "select" ? (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">선택...</option>
          {(options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
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
          ? v.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined;
    } else if (f.type === "checkbox") {
      out[f.name] = Boolean(v);
    } else {
      out[f.name] = v === "" ? undefined : v;
    }
  }
  return out;
}
