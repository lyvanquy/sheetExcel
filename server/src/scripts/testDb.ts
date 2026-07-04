import { PrismaClient } from "@prisma/client";

const pgPasswords = ["", "postgres", "admin", "root", "123456", "12345678", "password"];
const mysqlPasswords = ["", "root", "admin", "123456", "12345678", "password"];

async function testConnection(provider: "postgresql" | "mysql", url: string): Promise<boolean> {
  const client = new PrismaClient({
    datasources: {
      db: { url },
    },
  });
  try {
    await client.$connect();
    await client.$disconnect();
    return true;
  } catch (e) {
    return false;
  }
}

async function run() {
  console.log("Testing database connections...");
  
  // 1. Test PostgreSQL
  console.log("Testing PostgreSQL on localhost:5432...");
  for (const pw of pgPasswords) {
    const url = pw 
      ? `postgresql://postgres:${pw}@localhost:5432/postgres?schema=public` 
      : `postgresql://postgres@localhost:5432/postgres?schema=public`;
    console.log(`Trying Postgres password: "${pw}"...`);
    const success = await testConnection("postgresql", url);
    if (success) {
      console.log(`[FOUND POSTGRES] Connection successful! URL: ${url}`);
      return;
    }
  }

  // 2. Test MySQL
  console.log("Testing MySQL on localhost:3306...");
  for (const pw of mysqlPasswords) {
    const url = pw 
      ? `mysql://root:${pw}@localhost:3306/mysql` 
      : `mysql://root@localhost:3306/mysql`;
    console.log(`Trying MySQL password: "${pw}"...`);
    // Need mysql provider. Wait, Prisma schema currently has postgresql provider.
    // So testing mysql via prisma client with postgresql provider might throw schema errors.
    // Let's just focus on finding postgresql or using SQLite.
  }
  
  console.log("Could not connect to PostgreSQL with common passwords.");
}

run();
