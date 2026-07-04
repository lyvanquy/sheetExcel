import prisma from "../db";

async function main() {
  console.log("=== FILES IN DATABASE ===");
  const files = await prisma.excelFile.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  for (const f of files) {
    console.log(`- ID: ${f.id}`);
    console.log(`  Name: ${f.fileName}`);
    console.log(`  Status: ${f.status}`);
    console.log(`  Rules: ${f.rules}`);
    console.log(`  OriginalUrl: ${f.originalUrl}`);
    console.log(`  ResultUrl: ${f.resultUrl}`);
    console.log("------------------------");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
