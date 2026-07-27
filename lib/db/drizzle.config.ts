import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Relative, forward-slash paths — drizzle-kit resolves these relative to
  // this config file. Windows absolute paths built via path.join(__dirname)
  // use backslashes, which drizzle-kit's schema-file glob matcher fails to
  // match ("No schema files found"), even though the path is correct.
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
