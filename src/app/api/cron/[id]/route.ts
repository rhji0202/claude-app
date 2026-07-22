import { getHandler, patchHandler, deleteHandler } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return getHandler("cronJobs", id);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  return patchHandler("cronJobs", id, req);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return deleteHandler("cronJobs", id);
}
