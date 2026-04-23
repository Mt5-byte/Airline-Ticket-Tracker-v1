import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { RouteForm } from "@/components/route-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RoutesPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect("/sign-in?next=/routes");

  const tracked = await prisma.trackedRoute.findMany({
    where: { userId },
    include: { route: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="container pt-10 pb-20 max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Your routes</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Add any origin → destination pair. Skybird polls it every 60 seconds and emails you when
        the fare hits your target or drops below its rolling-30-day median.
      </p>
      <div className="mt-8">
        <RouteForm
          existing={tracked.map((t) => ({
            id: t.id,
            routeId: t.routeId,
            targetCents: t.targetCents,
            targetDropPct: t.targetDropPct,
            route: { origin: t.route.origin, destination: t.route.destination },
          }))}
        />
      </div>
    </div>
  );
}
