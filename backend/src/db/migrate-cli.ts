import { env } from '../env.js';
import { migrateDatabase } from './migrate.js';

try {
  await migrateDatabase(env.DATABASE_URL);
  console.log('Database migrations applied successfully.');
} catch {
  console.error('Database migration failed. Release stopped; check database connectivity, permissions and migration files.');
  process.exitCode = 1;
}
