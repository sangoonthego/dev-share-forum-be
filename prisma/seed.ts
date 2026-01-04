import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

async function seed() {
  console.log("Starting Seed process...");

  const passwordHash = await bcrypt.hash("admin123", 10);

  await prisma.users.upsert({
    where: { email: "admin123@gmail.com" },
    update: {},
    create: {
      email: "admin123@gmail.com",
      full_name: "System Administrator",
      password_hash: passwordHash,
      role: UserRole.ADMIN,
    },
  });

  console.log("Admin account ready");
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
