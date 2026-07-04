import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("=== SEEDING SECURE USER ACCOUNTS ===");

  const userPasswordHash = await bcrypt.hash("password123", 10);
  const adminPasswordHash = await bcrypt.hash("admin123", 10);

  // 1. Seed standard user
  const user = await prisma.user.upsert({
    where: { email: "user@example.com" },
    update: {
      password: userPasswordHash,
      role: "USER"
    },
    create: {
      email: "user@example.com",
      password: userPasswordHash,
      role: "USER"
    }
  });
  console.log("Seeded standard user:", { id: user.id, email: user.email, role: user.role });

  // 2. Seed admin user
  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {
      password: adminPasswordHash,
      role: "ADMIN"
    },
    create: {
      email: "admin@example.com",
      password: adminPasswordHash,
      role: "ADMIN"
    }
  });
  console.log("Seeded admin user:", { id: admin.id, email: admin.email, role: admin.role });

  console.log("Seeding secure users completed successfully.");
}

main()
  .catch((e) => {
    console.error("Error seeding secure users:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
