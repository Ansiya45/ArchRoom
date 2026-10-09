import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { sql } from 'drizzle-orm';
import { db } from './index.js';
import { users, authCodes, authSessions } from './schema.js';

export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function assertDatabaseReady() {
  const expected = readMigrationFiles({ migrationsFolder });
  const applied = await db.execute<{ created_at: string }>(
    sql`select created_at from drizzle.__drizzle_migrations`,
  );
  for (const migration of expected) {
    if (!applied.some(row => Number(row.created_at) === migration.folderMillis)) {
      throw new Error('Database migrations are missing. Run npm run db:migrate before starting the backend.');
    }
  }
  // Resolve every auth column without reading account data. The journal alone
  // cannot detect a manually removed table or column.
  await db.select().from(users).limit(0);
  await db.select().from(authCodes).limit(0);
  await db.select().from(authSessions).limit(0);
}
