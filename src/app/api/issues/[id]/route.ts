import { getHandler, patchHandler, deleteHandler } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return getHandler("issueTasks", id);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  return patchHandler("issueTasks", id, req);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return deleteHandler("issueTasks", id);
}
