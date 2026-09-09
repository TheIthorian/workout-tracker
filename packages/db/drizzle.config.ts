import { defineConfig } from 'drizzle-kit';

// The only place in the repo that reads DATABASE_URL outside an app bootstrap. drizzle-kit is a
// CLI, not a library, so it has no app to be configured by.
export default defineConfig({
    dialect: 'postgresql',
    schema: './src/schema/index.ts',
    out: './drizzle',
    dbCredentials: { url: process.env.DATABASE_URL ?? '' },
    casing: 'snake_case',
});
