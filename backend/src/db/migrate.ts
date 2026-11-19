import postgres from 'postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { coordinateDisposableMigration } from './disposable-migration-coordinator.js';
import { migrateMeetingHostAssignment } from './meeting-host-migration.js';

const defaultMigrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
export async function migrateDatabase(databaseUrl: string, migrationsFolder = defaultMigrationsFolder) {
  if (resolve(migrationsFolder) === resolve(defaultMigrationsFolder)) {
    if (process.env.NODE_ENV !== 'test' || process.env.PHASE_B_DISPOSABLE_COORDINATOR !== '1')
      throw new Error('Combined migration is disabled until the target lineage and production plan are reviewed.');
    await coordinateDisposableMigration(databaseUrl, fileURLToPath(new URL('../../', import.meta.url)));
    await migrateMeetingHostAssignment(databaseUrl, fileURLToPath(new URL('../../', import.meta.url)));
    return;
  }
  // Historical fixture replay is only for the independently identified test
  // cluster. A custom folder must never bypass the normal coordinator.
  const target = new URL(databaseUrl);
  if (process.env.NODE_ENV !== 'test' || target.protocol !== 'postgres:' || target.hostname !== '127.0.0.1' ||
      target.port !== '55470' || target.username !== 'ylaam_disposable_admin' || target.password || target.search ||
      !/^\/ylaam_(?:converge|senior|fresh)_disposable_[a-f0-9]{8}$/.test(target.pathname))
    throw new Error('Historical migration replay is restricted to the isolated disposable cluster.');
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 10, connection: { lock_timeout: 60000, statement_timeout: 120000 } });
  try {
    const migrations = readMigrationFiles({ migrationsFolder });
    await client.begin(async tx => {
      const [identity] = await tx`select current_database() as name,current_user as role,inet_server_addr()::text as host,inet_server_port() as port,current_setting('data_directory') as directory`;
      if (identity.name !== target.pathname.slice(1) || identity.role !== target.username || identity.host !== '127.0.0.1/32' ||
          identity.port !== 55470 || identity.directory !== 'D:/Development/ArchRoom/backend/.phase-b-confirmation-disposable-pg')
        throw new Error('Disposable cluster identity mismatch.');
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
