/**
 * API 라우트용 공통 CRUD 헬퍼.
 * 각 컬렉션의 route.ts는 이 헬퍼로 얇게 구성한다.
 */

import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import type { CollectionName, Collections } from "@/lib/types";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function badRequest(message: string) {
  return json({ error: message }, 400);
}

export function notFound(message = "찾을 수 없습니다.") {
  return json({ error: message }, 404);
}

/** GET: 컬렉션 목록 */
export async function listHandler<C extends CollectionName>(collection: C) {
  const rows = await store.list(collection);
  return json(rows);
}

/** POST: 컬렉션에 레코드 생성 */
export async function createHandler<C extends CollectionName>(
  collection: C,
  req: Request,
  validate?: (
    body: Record<string, unknown>,
  ) => { ok: true } | { ok: false; error: string },
) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("잘못된 JSON 본문입니다.");
  }
  if (validate) {
    const v = validate(body);
    if (!v.ok) return badRequest(v.error);
  }
  const record = await store.create(
    collection,
    body as Omit<Collections[C], "id" | "createdAt" | "updatedAt">,
  );
  return json(record, 201);
}

/** GET /:id */
export async function getHandler<C extends CollectionName>(
  collection: C,
  id: string,
) {
  const row = await store.get(collection, id);
  return row ? json(row) : notFound();
}

/** PATCH /:id */
export async function patchHandler<C extends CollectionName>(
  collection: C,
  id: string,
  req: Request,
) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badRequest("잘못된 JSON 본문입니다.");
  }
  const updated = await store.update(
    collection,
    id,
    body as Partial<Collections[C]>,
  );
  return updated ? json(updated) : notFound();
}

/** DELETE /:id */
export async function deleteHandler<C extends CollectionName>(
  collection: C,
  id: string,
) {
  const ok = await store.remove(collection, id);
  return ok ? json({ ok: true }) : notFound();
}
