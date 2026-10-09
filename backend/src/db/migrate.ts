import postgres from 'postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';

export async function migrateDatabase(databaseUrl: string, migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))) {
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 10, connection: { lock_timeout: 60000, statement_timeout: 120000 } });
  try {
    const migrations = readMigrationFiles({ migrationsFolder });
    await client.begin(async tx => {
      // Lock before reading the journal, with transaction-scoped release on
      // success, failure or disconnect. Compatible with transaction poolers.
      await tx`select pg_advisory_xact_lock(1790812800)`;
      await tx`create schema if not exists drizzle`;
      await tx`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
      const applied = await tx<{ created_at: string }[]>`select created_at from drizzle.__drizzle_migrations`;
      const latest = Math.max(0, ...applied.map(row => Number(row.created_at)));
      for (const migration of migrations) {
        if (applied.some(row => Number(row.created_at) === migration.folderMillis)) continue;
        if (migration.folderMillis <= latest) throw new Error('Migration history has a gap; repair it before releasing.');
        // SQL comes only from version-controlled Drizzle migration files.
        for (const statement of migration.sql) await tx.unsafe(statement);
        await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
      }
    });
  } finally { await client.end({ timeout: 5 }); }
}
