import { PrismaClient } from "@prisma/client";
import { CURATED_ROUTES } from "../src/lib/curated-routes";

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding ${CURATED_ROUTES.length} curated routes...`);
  for (const [origin, destination] of CURATED_ROUTES) {
    await prisma.route.upsert({
      where: { origin_destination: { origin, destination } },
      update: { isCurated: true },
      create: { origin, destination, isCurated: true },
    });
  }
  const total = await prisma.route.count();
  console.log(`Done. ${total} routes in DB.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
