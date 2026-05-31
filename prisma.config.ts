import { config } from "dotenv";
config({ path: ".env.local" });
import { defineConfig } from "prisma/config";

// Prisma CLI (db push / migrate) only supports file: URLs.
// The libsql:// Turso URL is handled at runtime via the adapter in lib/prisma.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: "file:./dev.db",
  },
});
