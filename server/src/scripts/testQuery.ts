import prisma from "../db";

async function run() {
  console.log("Querying prisma.excelFile.findMany()...");
  try {
    const start = Date.now();
    const files = await prisma.excelFile.findMany({
      include: { jobs: true }
    });
    console.log(`Query succeeded in ${Date.now() - start}ms! Found ${files.length} records.`);
    console.log("Records:", files);
  } catch (e: any) {
    console.error("Query failed with error:", e);
  } finally {
    await prisma.$disconnect();
  }
}

run();
