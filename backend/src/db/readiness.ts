import { fileURLToPath } from 'node:url';
import { db } from './index.js';
import { users, authCodes, authSessions } from './schema.js';
import { env } from '../env.js';
import { coordinateDisposableMigration } from './disposable-migration-coordinator.js';
import { hostAssignmentInstalled } from './meeting-host-migration.js';
import { client } from './index.js';

export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function assertDatabaseReady() {
  if (process.env.NODE_ENV !== 'test' || process.env.PHASE_B_DISPOSABLE_COORDINATOR !== '1')
    throw new Error('Combined database readiness is disabled until the target lineage and production plan are reviewed.');
  await coordinateDisposableMigration(env.DATABASE_URL, fileURLToPath(new URL('../../', import.meta.url)), undefined, true);
  if (!await hostAssignmentInstalled(client)) throw new Error('Apply the reviewed meeting host assignment extension before startup.');
  // Check the expected auth columns in addition to the coordinator's evidence.
  await db.select().from(users).limit(0);
  await db.select().from(authCodes).limit(0);
  await db.select().from(authSessions).limit(0);
}
