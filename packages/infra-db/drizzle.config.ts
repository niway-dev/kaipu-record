import { defineConfig } from "drizzle-kit";
import { TABLE_PREFIX } from "./src/config";

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
  tablesFilter: [`${TABLE_PREFIX}_*`],
});
