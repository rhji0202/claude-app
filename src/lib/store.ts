/**
 * 파일 기반 JSON 스토어 (뼈대 단계용 영속 계층).
 *
 * 실제 운영 단계에서는 이 모듈만 교체하면 Postgres/SQLite 등으로 옮길 수 있도록
 * 컬렉션 CRUD 인터페이스를 최소화해 두었다.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CollectionName, Collections } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");

function fileFor(collection: CollectionName): string {
  return path.join(DATA_DIR, `${collection}.json`);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readAll<C extends CollectionName>(
  collection: C,
): Promise<Collections[C][]> {
  await ensureDir();
  try {
    const raw = await fs.readFile(fileFor(collection), "utf8");
    return JSON.parse(raw) as Collections[C][];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll<C extends CollectionName>(
  collection: C,
  rows: Collections[C][],
): Promise<void> {
  await ensureDir();
  const tmp = fileFor(collection) + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2), "utf8");
  await fs.rename(tmp, fileFor(collection));
}

export const store = {
  async list<C extends CollectionName>(collection: C): Promise<Collections[C][]> {
    return readAll(collection);
  },

  async get<C extends CollectionName>(
    collection: C,
    id: string,
  ): Promise<Collections[C] | null> {
    const rows = await readAll(collection);
    return rows.find((r) => (r as { id: string }).id === id) ?? null;
  },

  async create<C extends CollectionName>(
    collection: C,
    data: Omit<Collections[C], "id" | "createdAt" | "updatedAt">,
  ): Promise<Collections[C]> {
    const rows = await readAll(collection);
    const now = new Date().toISOString();
    const record = {
      ...data,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    } as Collections[C];
    rows.push(record);
    await writeAll(collection, rows);
    return record;
  },

  async update<C extends CollectionName>(
    collection: C,
    id: string,
    patch: Partial<Collections[C]>,
  ): Promise<Collections[C] | null> {
    const rows = await readAll(collection);
    const idx = rows.findIndex((r) => (r as { id: string }).id === id);
    if (idx === -1) return null;
    const updated = {
      ...rows[idx],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    } as Collections[C];
    rows[idx] = updated;
    await writeAll(collection, rows);
    return updated;
  },

  async remove<C extends CollectionName>(
    collection: C,
    id: string,
  ): Promise<boolean> {
    const rows = await readAll(collection);
    const next = rows.filter((r) => (r as { id: string }).id !== id);
    if (next.length === rows.length) return false;
    await writeAll(collection, next);
    return true;
  },
};
