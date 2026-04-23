import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const tr = await prisma.trackedRoute.findUnique({ where: { id } });
  if (!tr || tr.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.trackedRoute.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
