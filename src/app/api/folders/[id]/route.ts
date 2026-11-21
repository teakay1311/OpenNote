import { deleteFolder, renameFolder } from "@/lib/folder-mutations";

export const dynamic = "force-dynamic";

type Route = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Route) {
  return renameFolder(request, (await params).id);
}

export async function DELETE(_request: Request, { params }: Route) {
  return deleteFolder((await params).id);
}
