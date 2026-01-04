// import "dotenv/config";
// import { defineConfig } from "prisma/config";

// export default defineConfig({
//   schema: "prisma/schema.prisma",
//   migrations: {
//     path: "prisma/migrations",
//   },
//   datasource: {
//     // url: process.env["DATABASE_URL"],
//     url: process.env.DATABASE_URL
//   },
// });

import "dotenv/config";
import { defineConfig } from "prisma/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// 1. Cấu hình dành cho Prisma CLI (Studio, Migrate)
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
});

// 2. Cấu hình Adapter dành cho Application logic
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
});

