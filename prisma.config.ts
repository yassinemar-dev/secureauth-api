import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Generate can run without a database; commands that connect need DATABASE_URL.
    url: process.env.DATABASE_URL ?? '',
  },
});
